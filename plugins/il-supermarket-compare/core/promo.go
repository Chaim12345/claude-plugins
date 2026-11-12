package core

import (
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Promotions (PromoFull files).
//
// The chains publish PromoFull in two shapes that differ in tag names:
//
//	Cerberus / Shufersal / Bina style: Promotion > Groups > Group > PromotionItems > PromotionItem,
//	  with ClubID on the promotion and MinQty, DiscountedPrice, DiscountRate, RewardType on each item.
//	Keshet style: those fields sit on the Promotion itself, items are PromotionItems > Item,
//	  and the clubs are Clubs > ClubId.
//
// Only the common mechanics that a basket calculation can apply honestly are modelled:
//
//	price   a fixed price per unit (MinQty 1, DiscountedPrice)
//	bundle  MinQty units for a total (2 for 10)
//	percent a percentage off the shelf price
//
// each with an optional club flag. Everything else is counted in PromoStats.Skipped by reason and
// ignored: coupons, gifts and "N+1", basket-level conditions (minimum purchase), weighted items,
// and promotions with a separate reward group (mix-and-match).

// Promo kinds.
const (
	KindPrice   = "price"
	KindBundle  = "bundle"
	KindPercent = "percent"
)

// Reasons a promotion was not modelled.
const (
	SkipCoupon       = "coupon"         // needs a coupon the shopper must receive first
	SkipGift         = "gift"           // free item, N+1, "מתנה": the reward is another product
	SkipBasket       = "basket_min"     // needs a minimum basket value
	SkipWeighted     = "weighted"       // priced per kg; the catalog matches fresh items by name, not code
	SkipMultiGroup   = "multi_group"    // separate buy and reward groups (mix and match)
	SkipUnsupported  = "unsupported"    // no price or percentage to apply, or an odd quantity
	SkipItemsOnly    = "no_items"       // lists no item codes
	SkipImplausible  = "implausible"    // promo price not below the shelf price (set at catalog build)
	SkipNotInCatalog = "not_in_catalog" // none of its items is a catalog product (set at catalog build)
	SkipExpired      = "expired"        // ended, or not started, at the price file's time (set at catalog build)
)

// Promo is one normalized promotion: terms that apply to a set of product codes.
type Promo struct {
	ID     string   `json:"id"`
	Codes  []string `json:"codes"`
	MinQty int      `json:"minQty"`
	Kind   string   `json:"kind"`
	// Value: price = agorot per unit; bundle = agorot for MinQty units; percent = percent off (e.g. 20).
	Value float64 `json:"value"`
	Club  bool    `json:"club"`
	Desc  string  `json:"desc"`
	Max   int     `json:"max,omitempty"` // most units the deal covers per purchase (0 = unlimited)
	// Start and End are YYYYMMDDhhmm in the chain's local time; empty = open-ended. Start is dropped from the catalog.
	Start string `json:"-"`
	End   string `json:"end,omitempty"`
	// second marks "the second one for X" promotions, whose published price is the second item's alone;
	// BuildPromos turns Value into the real price of the pair using each branch's shelf price.
	second bool
}

// PromoFile is a parsed PromoFull file.
type PromoFile struct {
	Total   int            // promotions in the file
	Promos  []Promo        // modelled promotions (a promotion with differing item terms yields several)
	Skipped map[string]int // promotions not modelled, by reason
}

// PromoStats is the per-store coverage that ends up in the catalog.
type PromoStats struct {
	Parsed  int            `json:"parsed"`  // promotions in the file
	Modeled int            `json:"modeled"` // promotions we understand (before filtering to the catalog)
	Applied int            `json:"applied"` // promotions kept in the catalog
	Skipped map[string]int `json:"skipped"`
}

// node is a minimal XML tree for one promotion.
type node struct {
	name string
	text strings.Builder
	kids []*node
}

func (n *node) child(names ...string) *node {
	for _, k := range n.kids {
		for _, nm := range names {
			if k.name == nm {
				return k
			}
		}
	}
	return nil
}

func (n *node) children(names ...string) []*node {
	var out []*node
	for _, k := range n.kids {
		for _, nm := range names {
			if k.name == nm {
				out = append(out, k)
			}
		}
	}
	return out
}

// val returns the trimmed text of the first child with one of the names.
func (n *node) val(names ...string) string {
	if n == nil {
		return ""
	}
	if k := n.child(names...); k != nil {
		return strings.TrimSpace(k.text.String())
	}
	return ""
}

func (n *node) num(names ...string) float64 {
	f, _ := strconv.ParseFloat(n.val(names...), 64)
	return f
}

// eachPromotion streams the file and calls fn with a tree for every Promotion (or Sale) element.
func eachPromotion(r io.Reader, fn func(*node)) error {
	in, err := openXML(r)
	if err != nil {
		return err
	}
	dec := xml.NewDecoder(in)
	dec.CharsetReader = func(_ string, input io.Reader) (io.Reader, error) { return input, nil }
	dec.Strict = false
	var stack []*node
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
			name := strings.ToLower(t.Name.Local)
			if len(stack) == 0 && name != "promotion" && name != "sale" {
				continue
			}
			n := &node{name: name}
			if len(stack) > 0 {
				p := stack[len(stack)-1]
				p.kids = append(p.kids, n)
			}
			stack = append(stack, n)
		case xml.CharData:
			if len(stack) > 0 {
				stack[len(stack)-1].text.Write(t)
			}
		case xml.EndElement:
			if len(stack) == 0 {
				continue
			}
			n := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if len(stack) == 0 {
				fn(n)
			}
		}
	}
}

// ParsePromoFile reads a PromoFull file (gzipped or plain XML).
func ParsePromoFile(r io.Reader) (*PromoFile, error) {
	pf := &PromoFile{Skipped: map[string]int{}}
	err := eachPromotion(r, func(n *node) {
		pf.Total++
		ps, why := normalizePromotion(n)
		if len(ps) == 0 {
			pf.Skipped[why]++
			return
		}
		pf.Promos = append(pf.Promos, ps...)
	})
	if err != nil && pf.Total == 0 {
		return nil, err
	}
	return pf, err
}

// isEveryone reports whether a ClubID value means all customers. Values look like "0",
// "0 - כלל הלקוחות" or "1 - מועדון לקוחות , 3 - מועדון לקוחות באשראי".
func isEveryone(ids []string) bool {
	named := false
	for _, v := range ids {
		for _, part := range strings.Split(v, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			named = true
			end := 0
			for end < len(part) && part[end] >= '0' && part[end] <= '9' {
				end++
			}
			if end > 0 {
				if n, _ := strconv.Atoi(part[:end]); n == 0 {
					return true
				}
			}
		}
	}
	return !named
}

// timestamp turns the date and hour fields into YYYYMMDDhhmm. The date may carry its own time
// ("2023-06-18T00:00:00.000"); a separate hour field is used when the date has none.
func timestamp(date, hour string) string {
	date = strings.TrimSpace(date)
	if len(date) < 10 {
		return ""
	}
	d := strings.ReplaceAll(date[:10], "-", "")
	if len(d) != 8 {
		return ""
	}
	clock := ""
	if len(date) > 11 {
		clock = date[11:]
	}
	if hour = strings.TrimSpace(hour); hour != "" && (clock == "" || strings.HasPrefix(clock, "00:00")) {
		clock = hour
	}
	hh, mm := "00", "00"
	if len(clock) >= 5 && clock[2] == ':' {
		hh, mm = clock[:2], clock[3:5]
	}
	return d + hh + mm
}

func hasAny(s string, words ...string) bool {
	for _, w := range words {
		if strings.Contains(s, w) {
			return true
		}
	}
	return false
}

type terms struct {
	kind   string
	minQty int
	value  float64 // ₪ or percent, as published
	max    int
	second bool
}

// normalizePromotion turns one Promotion element into modelled promos, or says why it can't.
func normalizePromotion(n *node) ([]Promo, string) {
	desc := n.val("promotiondescription")
	id := n.val("promotionid")
	if id == "" {
		id = "x" + desc
	}
	if hasAny(desc, "קופון") || n.val("additionaliscoupon") == "1" || n.child("additionalrestrictions").val("additionaliscoupon") == "1" {
		return nil, SkipCoupon
	}

	// Clubs: ClubID (text) or Clubs > ClubId (one or more).
	var clubs []string
	if v := n.val("clubid"); v != "" {
		clubs = append(clubs, v)
	}
	if c := n.child("clubs"); c != nil {
		for _, k := range c.children("clubid") {
			clubs = append(clubs, strings.TrimSpace(k.text.String()))
		}
	}
	club := !isEveryone(clubs)

	// Items: either Groups > Group > PromotionItems > PromotionItem, or a flat PromotionItems > Item.
	type entry struct {
		it     *node
		minAmt float64
	}
	var entries []entry
	groups := 0
	if g := n.child("groups"); g != nil {
		for _, grp := range g.children("group") {
			groups++
			minAmt := grp.num("minpurchaseamount", "minpurchaseamnt")
			if pi := grp.child("promotionitems"); pi != nil {
				for _, it := range pi.kids {
					entries = append(entries, entry{it, minAmt})
				}
			}
		}
	} else if pi := n.child("promotionitems"); pi != nil {
		groups = 1
		minAmt := n.num("minpurchaseamount", "minpurchaseamnt")
		for _, it := range pi.kids {
			entries = append(entries, entry{it, minAmt})
		}
	}
	if len(entries) == 0 {
		return nil, SkipItemsOnly
	}
	if groups > 1 {
		return nil, SkipMultiGroup // one group buys, another is rewarded
	}
	if hasAny(desc, "מתנה") {
		return nil, SkipGift
	}

	start := timestamp(n.val("promotionstartdatetime", "promotionstartdate"), n.val("promotionstarthour"))
	end := timestamp(n.val("promotionenddatetime", "promotionenddate"), n.val("promotionendhour"))
	weightedPromo := n.val("isweightedpromo") == "1"

	byTerms := map[terms]*Promo{}
	var order []terms
	why := SkipUnsupported
	for _, e := range entries {
		it := e.it
		get := func(names ...string) string { // item-level first, then the promotion's own fields (Keshet)
			if v := it.val(names...); v != "" {
				return v
			}
			return n.val(names...)
		}
		num := func(names ...string) float64 { f, _ := strconv.ParseFloat(get(names...), 64); return f }
		code := strings.TrimLeft(it.val("itemcode"), "0")
		if code == "" {
			continue
		}
		if it.val("isgiftitem") == "1" { // Keshet marks the reward item itself
			why = SkipGift
			continue
		}
		if e.minAmt > 0 || n.num("minpurchaseamount", "minpurchaseamnt") > 0 {
			why = SkipBasket
			continue
		}
		if weightedPromo || it.val("bisweighted") == "1" {
			why = SkipWeighted
			continue
		}
		minQ := num("minqty")
		dp := num("discountedprice")
		dr := num("discountrate")
		if dr > 100 { // Keshet writes 20% as 2000
			dr /= 100
		}
		if minQ < 1 {
			minQ = 1
		}
		if minQ != math.Trunc(minQ) || minQ > 20 {
			why = SkipUnsupported
			continue
		}
		var t terms
		switch {
		case dp > 0 && minQ == 1:
			t = terms{kind: KindPrice, minQty: 1, value: dp}
		case dp > 0:
			t = terms{kind: KindBundle, minQty: int(minQ), value: dp}
			if minQ == 2 && secondItemRx.MatchString(desc) {
				t.second = true
			}
		case dr > 0 && dr < 100 && minQ == 1:
			t = terms{kind: KindPercent, minQty: 1, value: dr}
		case dr >= 100 || minQ > 1:
			why = SkipGift // free, or "N units, M free"
			continue
		default:
			why = SkipUnsupported
			continue
		}
		t.max = int(num("maxqty"))
		if t.max == 0 {
			t.max = limitFromText(desc)
			if t.kind == KindBundle && t.max > 0 && t.max < t.minQty {
				t.max *= t.minQty // "3ב10 מו1": one redemption of the bundle, not one unit
			}
		}
		if t.max == 0 {
			// RedemptionLimit counts redemptions: 2 for "2ב100 מו4" (four units).
			if rl := n.num("redemptionlimit"); rl >= 1 && rl <= 50 && rl == math.Trunc(rl) {
				t.max = int(rl) * t.minQty
			}
		}
		p := byTerms[t]
		if p == nil {
			p = &Promo{ID: id, MinQty: t.minQty, Kind: t.kind, Value: t.value, Club: club, Desc: CleanPromoDesc(desc), Max: t.max, Start: start, End: end, second: t.second}
			if t.kind != KindPercent {
				p.Value = math.Round(t.value * 100) // agorot
			}
			byTerms[t] = p
			order = append(order, t)
		}
		p.Codes = append(p.Codes, code)
	}
	if len(order) == 0 {
		return nil, why
	}
	out := make([]Promo, 0, len(order))
	for _, t := range order {
		out = append(out, *byTerms[t])
	}
	return out, ""
}

// limitRx reads the unit limit the chains write into the description when they leave MaxQty empty:
// "ב7.90 מו3", "12.9 מוג 3", "מוגבל ל3".
var limitRx = regexp.MustCompile(`(?:^|\s)(?:מוגבל\s*ל-?\s*|מוג\s?|מו\s?)(\d{1,2})(?:\s|$)`)

func limitFromText(desc string) int {
	m := limitRx.FindStringSubmatch(desc)
	if m == nil {
		return 0
	}
	n, _ := strconv.Atoi(m[1])
	return n
}

// secondItemRx matches "השני בחצי מחיר", "השני ב-5", "המוצר השני ב…": the published price is the
// second item's, not the price of the pair.
var secondItemRx = regexp.MustCompile(`(?:^|[\s,/-])ה?שני(?:ה|יה)?\s*(?:ב|ל|בחצי)`)

// CleanPromoDesc collapses whitespace in a promotion description.
func CleanPromoDesc(s string) string { return strings.Join(strings.Fields(s), " ") }

// priceAfter returns the cost of q units of a product at shelf price p (agorot) under promo pr,
// or p*q when the promo doesn't apply.
func (pr Promo) priceAfter(p float64, q int) float64 {
	units := q
	if pr.Max > 0 && pr.Max < units {
		units = pr.Max
	}
	rest := float64(q-units) * p
	switch pr.Kind {
	case KindPrice:
		return rest + float64(units)*pr.Value
	case KindPercent:
		return rest + float64(units)*p*(1-pr.Value/100)
	case KindBundle:
		n := units / pr.MinQty
		return rest + float64(n)*pr.Value + float64(units-n*pr.MinQty)*p
	}
	return p * float64(q)
}

// BuildPromos keeps, for each store, the modelled promotions that matter to the catalog: not
// expired at the price file's time, in effect, and cheaper than the shelf price for at least one
// catalog product. Each store's codes are cut down to catalog products sold there. The returned
// stats include the reasons promotions were dropped.
func BuildPromos(stores []StoreData, products [][]any) ([][]Promo, []PromoStats) {
	// shelf[code][storeIdx] in agorot
	shelf := make(map[string][]any, len(products))
	for _, p := range products {
		if p[3].(int) == 0 {
			shelf[p[0].(string)] = p[4].([]any)
		}
	}
	out := make([][]Promo, len(stores))
	stats := make([]PromoStats, len(stores))
	for i, sd := range stores {
		st := PromoStats{Skipped: map[string]int{}}
		out[i] = []Promo{}
		if sd.Promos == nil {
			stats[i] = st
			continue
		}
		st.Parsed = sd.Promos.Total
		for k, v := range sd.Promos.Skipped {
			st.Skipped[k] += v
		}
		now := sd.Store.FileTime // YYYYMMDDhhmm, same local-time frame as the promo dates
		seen := map[string]bool{}
		dropped := map[string]string{} // promo id -> reason it produced nothing
		kept := map[string]bool{}
		for _, pr := range sd.Promos.Promos {
			seen[pr.ID] = true
			if now != "" && ((pr.End != "" && pr.End < now) || (pr.Start != "" && pr.Start > now)) {
				dropped[pr.ID] = SkipExpired
				continue
			}
			var codes []string
			var pairs map[float64][]string // second-item promos: price of the pair -> codes
			for _, c := range pr.Codes {
				prices, ok := shelf[c]
				if !ok || prices[i] == nil {
					continue
				}
				p := float64(prices[i].(int))
				if pr.second {
					if pr.Value >= p { // the "discounted" second item costs as much as a full-price one
						if dropped[pr.ID] == "" {
							dropped[pr.ID] = SkipImplausible
						}
						continue
					}
					if pairs == nil {
						pairs = map[float64][]string{}
					}
					pairs[p+pr.Value] = append(pairs[p+pr.Value], c) // full price for the first, the published price for the second
					continue
				}
				eff := pr.priceAfter(p, pr.MinQty) / float64(pr.MinQty)
				if eff >= p || eff < 0.25*p {
					if dropped[pr.ID] == "" {
						dropped[pr.ID] = SkipImplausible
					}
					continue
				}
				codes = append(codes, c)
			}
			if pr.second {
				totals := make([]float64, 0, len(pairs))
				for t := range pairs {
					totals = append(totals, t)
				}
				sort.Float64s(totals)
				for _, t := range totals {
					q := pr
					q.second = false
					q.Value = t
					q.Codes = pairs[t]
					sort.Strings(q.Codes)
					out[i] = append(out[i], q)
					kept[pr.ID] = true
				}
				if len(totals) == 0 && dropped[pr.ID] == "" {
					dropped[pr.ID] = SkipNotInCatalog
				}
				continue
			}
			if len(codes) == 0 {
				if dropped[pr.ID] == "" {
					dropped[pr.ID] = SkipNotInCatalog
				}
				continue
			}
			sort.Strings(codes)
			pr.Codes = codes
			out[i] = append(out[i], pr)
			kept[pr.ID] = true
		}
		st.Modeled = len(seen)
		for id, why := range dropped {
			if !kept[id] {
				st.Skipped[why]++
			}
		}
		st.Applied = len(kept)
		stats[i] = st
	}
	return out, stats
}
