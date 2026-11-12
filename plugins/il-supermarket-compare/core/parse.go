package core

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/xml"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// Item is one row of a chain's PriceFull file.
type Item struct {
	Code     string  `json:"code"`
	Name     string  `json:"name"`
	Price    float64 `json:"price"`
	Qty      string  `json:"qty,omitempty"`
	Unit     string  `json:"unit,omitempty"`
	Weighted bool    `json:"weighted,omitempty"` // true = Price is per kg
	Maker    string  `json:"maker,omitempty"`
	// The rest feed ProductMeta (meta.go); every chain fills them differently, or not at all.
	UnitQty string `json:"unitQty,omitempty"` // the unit Qty is in: "גרם", "מיליליטר", "יחידות"
	Country string `json:"country,omitempty"` // "IL", "ישראל", "IT"...
	Updated string `json:"updated,omitempty"` // when this branch last changed the price
	Sold    string `json:"sold,omitempty"`    // when this branch last sold the item
}

// StoreRow is one branch from a chain's Stores file.
type StoreRow struct {
	Chain    string `json:"chain"`
	StoreID  string `json:"store_id"`
	Name     string `json:"name"`
	Address  string `json:"address"`
	City     string `json:"city"`
	SubChain string `json:"subchain,omitempty"`
}

// openXML unwraps gzip if present and normalizes the text to UTF-8 without a BOM.
// The chains publish UTF-8 (often with a BOM) and, at some portals, UTF-16.
func openXML(r io.Reader) (io.Reader, error) {
	br := bufio.NewReaderSize(r, 64<<10)
	if magic, _ := br.Peek(2); len(magic) == 2 && magic[0] == 0x1f && magic[1] == 0x8b {
		gz, err := gzip.NewReader(br)
		if err != nil {
			return nil, fmt.Errorf("gzip: %w", err)
		}
		br = bufio.NewReaderSize(gz, 64<<10)
	}
	head, _ := br.Peek(3)
	switch {
	case len(head) >= 3 && head[0] == 0xEF && head[1] == 0xBB && head[2] == 0xBF:
		br.Discard(3)
		return br, nil
	case len(head) >= 2 && (head[0] == 0xFF && head[1] == 0xFE || head[0] == 0xFE && head[1] == 0xFF):
		all, err := io.ReadAll(br)
		if err != nil {
			return nil, err
		}
		return bytes.NewReader(utf16ToUTF8(all)), nil
	}
	return br, nil
}

func utf16ToUTF8(b []byte) []byte {
	big := b[0] == 0xFE
	b = b[2:]
	u := make([]uint16, len(b)/2)
	for i := range u {
		if big {
			u[i] = uint16(b[2*i])<<8 | uint16(b[2*i+1])
		} else {
			u[i] = uint16(b[2*i+1])<<8 | uint16(b[2*i])
		}
	}
	out := make([]byte, 0, len(u)*2)
	for _, r := range utf16.Decode(u) {
		out = utf8.AppendRune(out, r)
	}
	return out
}

// eachRecord streams the XML and calls fn with the direct children of every element named tag
// (case-insensitive), keyed by lower-cased child name. Memory stays flat regardless of file size.
func eachRecord(r io.Reader, tag string, fn func(map[string]string)) error {
	in, err := openXML(r)
	if err != nil {
		return err
	}
	dec := xml.NewDecoder(in)
	// The text is already UTF-8; some files still declare utf-16 or windows-1255 in the prolog.
	dec.CharsetReader = func(_ string, input io.Reader) (io.Reader, error) { return input, nil }
	dec.Strict = false
	depth, recDepth := 0, -1
	var rec map[string]string
	var field string
	var text strings.Builder
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("xml: %w", err)
		}
		switch t := tok.(type) {
		case xml.StartElement:
			depth++
			name := strings.ToLower(t.Name.Local)
			if recDepth < 0 && name == tag {
				recDepth, rec = depth, make(map[string]string, 16)
			} else if recDepth >= 0 && depth == recDepth+1 {
				field = name
				text.Reset()
			}
		case xml.CharData:
			if field != "" {
				text.Write(t)
			}
		case xml.EndElement:
			if recDepth >= 0 && depth == recDepth+1 && field != "" {
				rec[field] = strings.TrimSpace(text.String())
				field = ""
			} else if depth == recDepth {
				if len(rec) > 0 {
					fn(rec)
				}
				recDepth, rec = -1, nil
			}
			depth--
		}
	}
}

// ParsePriceFile reads a PriceFull file (gzipped or plain XML).
func ParsePriceFile(r io.Reader) ([]Item, error) {
	items := make([]Item, 0, 8000)
	err := eachRecord(r, "item", func(m map[string]string) {
		price, err := strconv.ParseFloat(m["itemprice"], 64)
		if err != nil || price <= 0 {
			return
		}
		maker := m["manufacturername"]
		if maker == "" {
			maker = m["manufacturename"]
		}
		items = append(items, Item{
			Code:     strings.TrimLeft(m["itemcode"], "0"),
			Name:     CleanName(m["itemname"]),
			Price:    price,
			Qty:      m["quantity"],
			Unit:     m["unitofmeasure"],
			Weighted: m["bisweighted"] == "1" || m["blsweighted"] == "1", // Wolt writes a lower-case L
			Maker:    maker,
			UnitQty:  m["unitqty"],
			Country:  m["manufacturecountry"],
			Updated:  first(m["priceupdatetime"], m["priceupdatedate"]),
			Sold:     m["lastsaledatetime"],
		})
	})
	return items, err
}

func first(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// ParseStoresFile reads a chain's Stores file.
func ParseStoresFile(r io.Reader, chain string) ([]StoreRow, error) {
	var out []StoreRow
	err := eachRecord(r, "store", func(m map[string]string) {
		id := strings.TrimLeft(m["storeid"], "0")
		if id == "" {
			id = "0"
		}
		out = append(out, StoreRow{Chain: chain, StoreID: id, Name: m["storename"], Address: m["address"], City: m["city"], SubChain: m["subchainname"]})
	})
	return out, err
}

// CleanName strips promo markers ("*מבצע*") and collapses whitespace.
func CleanName(n string) string {
	n = strings.ReplaceAll(n, "*מבצע*", "")
	n = strings.ReplaceAll(n, "מבצע*", "")
	n = strings.ReplaceAll(n, "*", " ")
	return strings.Trim(strings.Join(strings.Fields(n), " "), " -")
}
