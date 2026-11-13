// audit: accounts for every item row in a catalog's price files. Each row is either in the catalog
// (its code, or "<chain>:<code>", priced at that branch, or picked by a fresh rule there) or is
// reported with the reason it is not.
//
// Usage: go run ./cmd/audit <raw dir> <catalog.json> [lost.tsv]
package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
)

var itemTag = regexp.MustCompile(`(?i)<item[\s>]`)

func main() {
	var cat struct {
		Products [][]any
		Stores   []struct{ ID string }
	}
	b, err := os.ReadFile(os.Args[2])
	if err != nil {
		panic(err)
	}
	json.Unmarshal(b, &cat)
	type key struct {
		code  string
		store int
	}
	priced := map[key]bool{} // code (or chain:code) priced at store i
	picked := map[key]bool{} // a fresh rule picked this item name at store i
	for _, p := range cat.Products {
		prices, _ := p[4].([]any)
		for i, v := range prices {
			if v != nil {
				priced[key{p[0].(string), i}] = true
			}
		}
		if m, ok := p[7].(map[string]any); ok { // listed without a price, or an outlier price set aside
			if np, ok := m["np"].([]any); ok {
				for _, v := range np {
					priced[key{p[0].(string), int(v.(float64))}] = true
				}
			}
			if odd, ok := m["odd"].([]any); ok {
				for _, v := range odd {
					priced[key{p[0].(string), int(v.([]any)[0].(float64))}] = true
				}
			}
		}
		if picks, ok := p[5].([]any); ok {
			for i, v := range picks {
				if s, ok := v.(string); ok {
					picked[key{s, i}] = true
				}
			}
		}
	}

	all, _ := filepath.Glob(filepath.Join(os.Args[1], "*PriceFull*"))
	rows, parsed := 0, 0
	lost := map[string]int{}
	var lostRows []string
	for i, st := range cat.Stores {
		ch, id, _ := strings.Cut(st.ID, ":")
		n := id
		for len(n) < 3 {
			n = "0" + n
		}
		var file string
		for _, f := range all {
			base := filepath.Base(f)
			if strings.HasPrefix(base, ch+"_") && strings.Contains(base, "-"+n+"-") && f > file {
				file = f // the newest
			}
		}
		if file == "" {
			fmt.Printf("store %s: no price file in the raw folder\n", st.ID)
			continue
		}
		raw, _ := os.ReadFile(file)
		var r io.Reader = bytes.NewReader(raw)
		if gz, err := gzip.NewReader(bytes.NewReader(raw)); err == nil {
			r = gz
		}
		xml, _ := io.ReadAll(r)
		fileRows := len(itemTag.FindAll(xml, -1))
		items, err := core.ParsePriceFile(bytes.NewReader(xml))
		if err != nil {
			fmt.Printf("store %s: parse error %v\n", st.ID, err)
		}
		rows += fileRows
		parsed += len(items)
		if d := fileRows - len(items); d > 0 {
			lost["parser: row not read"] += d
		}
		seen := map[string]bool{}
		for _, it := range items {
			k := it.Code
			if len(it.Code) < 7 || it.Weighted {
				code := it.Code
				if code == "" {
					code = "n:" + it.Name
				}
				k = ch + ":" + code
			}
			switch {
			case priced[key{k, i}] || priced[key{it.Code, i}]:
			case it.Weighted && picked[key{it.Name, i}]:
			case seen[it.Code]:
				lost["same code twice in one file"]++
			default:
				reason := "not in catalog"
				if it.Weighted {
					reason = "weighed item matched a fresh rule but not picked"
				}
				lost[reason]++
				if len(lostRows) < 5000 {
					lostRows = append(lostRows, fmt.Sprintf("%s\t%s\t%s\t%.2f\t%v", st.ID, it.Code, it.Name, it.Price, it.Weighted))
				}
			}
			seen[it.Code] = true
		}
	}
	fmt.Printf("item rows in files %d, parsed %d\n", rows, parsed)
	total := 0
	var reasons []string
	for r, n := range lost {
		total += n
		reasons = append(reasons, fmt.Sprintf("  %-50s %d", r, n))
	}
	sort.Strings(reasons)
	fmt.Printf("rows not represented in the catalog: %d\n%s\n", total, strings.Join(reasons, "\n"))
	if len(os.Args) > 3 {
		os.WriteFile(os.Args[3], []byte(strings.Join(lostRows, "\n")), 0o644)
	}
}
