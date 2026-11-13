package shop

import (
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
)

// StaleDays: a branch that hasn't sold an item for this long probably doesn't have it on the shelf.
const StaleDays = 30

// Index is a catalog ready for the UI: typed products, a word index for search, and promotions by branch.
type Index struct {
	Cat      *core.Catalog
	Products []*Product
	ByCode   map[string]*Product
	Stores   []core.Store
	Chains   []string                      // portal key per store index ("shufersal", "RamiLevi")
	promos   []map[string][]core.Promo     // store index -> code -> promotions
	notes    []map[string][]core.PromoNote // store index -> code -> conditional promotions
	words    map[string][]int32            // word -> products whose search key has it
	vocab    []string                      // the words, for substring lookups
	Built    time.Time
	Alias    map[string]string // codes merged into another product (curation) -> that product
}

// FromCatalog types a catalog's product rows (they arrive as JSON-shaped [][]any) and indexes them.
// recs are the model's product records (category, brand, type, diet), applied when given.
func FromCatalog(c *core.Catalog, recs map[string]*Record, cur ...*Curation) (*Index, error) {
	raw, err := json.Marshal(c.Products)
	if err != nil {
		return nil, err
	}
	var rows [][]json.RawMessage
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	ix := &Index{Cat: c, ByCode: make(map[string]*Product, len(rows)), Stores: c.Stores, words: map[string][]int32{}, Built: time.Now()}
	for _, s := range c.Stores {
		k, _, _ := strings.Cut(s.ID, ":")
		ix.Chains = append(ix.Chains, k)
	}
	for _, r := range rows {
		p, err := productOf(r, len(c.Stores))
		if err != nil {
			return nil, fmt.Errorf("product row: %w", err)
		}
		if rec := recs[p.Code]; rec != nil {
			p.AI = rec
			if rec.C != "" && validCat(c, rec.C) {
				p.Cat = rec.C
			}
		}
		ix.ByCode[p.Code] = p
		ix.Products = append(ix.Products, p)
	}
	var cu *Curation
	if len(cur) > 0 {
		cu = cur[0]
	}
	alias := ix.applyCuration(cu) // tidied names and merged duplicates, before the search index
	for _, p := range ix.Products {
		p.Key = searchKey(p)
	}
	for i, p := range ix.Products {
		seen := map[string]bool{}
		for _, w := range strings.Fields(p.Key) {
			if !seen[w] {
				seen[w] = true
				ix.words[w] = append(ix.words[w], int32(i))
			}
		}
	}
	for w := range ix.words {
		ix.vocab = append(ix.vocab, w)
	}
	sort.Strings(ix.vocab)
	ix.promos = make([]map[string][]core.Promo, len(c.Stores))
	ix.notes = make([]map[string][]core.PromoNote, len(c.Stores))
	for i := range c.Stores {
		m := map[string][]core.Promo{}
		if i < len(c.Promos) {
			for _, pr := range c.Promos[i] {
				for _, code := range pr.Codes {
					if to, ok := alias[code]; ok {
						code = to // a merged barcode's promotions belong to the product it joined
					}
					m[code] = append(m[code], pr)
				}
			}
		}
		ix.promos[i] = m
		n := map[string][]core.PromoNote{}
		if i < len(c.PromoNotes) {
			for _, pn := range c.PromoNotes[i] {
				for _, code := range pn.Codes {
					if to, ok := alias[code]; ok {
						code = to
					}
					n[code] = append(n[code], pn)
				}
			}
		}
		ix.notes[i] = n
	}
	return ix, nil
}

func validCat(c *core.Catalog, id string) bool {
	for _, x := range c.Categories {
		if x.ID == id {
			return true
		}
	}
	return false
}

type metaJSON struct {
	Size  []any    `json:"size"`
	Maker string   `json:"maker"`
	IL    bool     `json:"il"`
	Stale [][2]int `json:"stale"`
	Chg   [][2]int `json:"chg"`
	NP    []int    `json:"np"`
	Odd   [][2]int `json:"odd"`
	Raw   string   `json:"raw"`
}

func productOf(r []json.RawMessage, nStores int) (*Product, error) {
	if len(r) < 5 {
		return nil, fmt.Errorf("short row")
	}
	p := &Product{}
	var w int
	if err := json.Unmarshal(r[0], &p.Code); err != nil {
		return nil, err
	}
	json.Unmarshal(r[1], &p.Name)
	json.Unmarshal(r[2], &p.Cat)
	json.Unmarshal(r[3], &w)
	p.Weighted = w == 1
	var prices []*float64
	json.Unmarshal(r[4], &prices)
	p.Prices = make([]int32, nStores)
	for i := range p.Prices {
		p.Prices[i] = -1
		if i < len(prices) && prices[i] != nil {
			p.Prices[i] = int32(*prices[i])
		}
	}
	if len(r) > 5 {
		var picks []*string
		if json.Unmarshal(r[5], &picks) == nil && picks != nil {
			p.Picks = make([]string, nStores)
			for i := range p.Picks {
				if i < len(picks) && picks[i] != nil {
					p.Picks[i] = *picks[i]
				}
			}
		}
	}
	if len(r) > 6 {
		json.Unmarshal(r[6], &p.Img)
	}
	if len(r) > 7 && string(r[7]) != "null" {
		var m metaJSON
		if json.Unmarshal(r[7], &m) == nil {
			p.Maker, p.IL, p.NP, p.Odd, p.RawName = m.Maker, m.IL, m.NP, m.Odd, m.Raw
			p.Stale, p.Chg = map[int]int{}, map[int]int{}
			for _, x := range m.Stale {
				p.Stale[x[0]] = x[1]
			}
			for _, x := range m.Chg {
				p.Chg[x[0]] = x[1]
			}
			if len(m.Size) == 3 {
				amt, _ := m.Size[0].(float64)
				unit, _ := m.Size[1].(string)
				agree, _ := m.Size[2].(float64)
				k := Count
				switch unit {
				case "g":
					k = Weight
				case "ml":
					k = Volume
				}
				p.StatedSize, p.StatedAgree = StatedSize{k, amt}, int(agree)
			}
		}
	}
	return p, nil
}

// Norm is the app's search normalisation: no quote marks, single spaces, lower case.
func Norm(s string) string {
	s = strings.NewReplacer(`"`, "", "'", "", "׳", "", "״", "", "`", "").Replace(s)
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

// searchKey: the name, the manufacturer and the original name when tidied, and the model's type,
// brand, line and diet labels, so "אסם" or "ללא גלוטן" finds products whose names don't say so.
func searchKey(p *Product) string {
	parts := []string{p.Name}
	if p.Maker != "" && !strings.Contains(Norm(p.Name), Norm(p.Maker)) {
		parts = append(parts, p.Maker)
	}
	if p.RawName != "" {
		parts = append(parts, p.RawName)
	}
	if r := p.AI; r != nil {
		parts = append(parts, r.T, r.B, r.L, r.V)
		for _, d := range r.D {
			parts = append(parts, DietLabel[d])
		}
	}
	return Norm(strings.Join(parts, " "))
}

// PriceInfo: cheapest and dearest price among the active stores, the cheapest store, and how many list
// it. A price at a branch that hasn't sold the item for a month only counts when no other branch sells it.
type PriceInfo struct {
	Lo, Hi int32 // -1 = none
	At     int   // -1 = none
	N      int
}

func (p *Product) PriceInfo(active []int) PriceInfo {
	pi := PriceInfo{-1, -1, -1, 0}
	slo, shi, sat := int32(-1), int32(-1), -1
	for _, i := range active {
		v := p.Prices[i]
		if v < 0 {
			continue
		}
		pi.N++
		if p.IsStale(i) {
			if slo < 0 || v < slo {
				slo, sat = v, i
			}
			if v > shi {
				shi = v
			}
			continue
		}
		if pi.Lo < 0 || v < pi.Lo {
			pi.Lo, pi.At = v, i
		}
		if v > pi.Hi {
			pi.Hi = v
		}
	}
	if pi.Lo < 0 {
		pi.Lo, pi.Hi, pi.At = slo, shi, sat
	}
	return pi
}

// ListedAt is the first active store listing the product without a usable price, or -1.
func (p *Product) ListedAt(active []int) int {
	for _, i := range p.NP {
		if slices.Contains(active, i) {
			return i
		}
	}
	for _, o := range p.Odd {
		if slices.Contains(active, o[0]) {
			return o[0]
		}
	}
	return -1
}

// Hit is a search result.
type Hit struct {
	P  *Product
	PI PriceInfo
}

// SearchOpts filter and order a search.
type SearchOpts struct {
	Cat    string // "" or "all" = every category
	Sort   string // "pop" (default), "cheap", "gap", "unit"
	Keep   func(*Product) bool
	Active []int
}

// Search finds the products whose search key contains every word of q (as substrings, like the app).
// With an empty q it lists the category. Candidates come from the word index: each query word is
// looked up among the words it is part of, and the lists are intersected.
func (ix *Index) Search(q string, o SearchOpts) []Hit {
	terms := strings.Fields(Norm(q))
	var cand []int32
	if len(terms) > 0 {
		for k, t := range terms {
			set := ix.candidates(t)
			if k == 0 {
				cand = set
			} else {
				cand = intersect(cand, set)
			}
			if len(cand) == 0 {
				return nil
			}
		}
	}
	var out []Hit
	check := func(p *Product) {
		if o.Cat != "" && o.Cat != "all" && p.Cat != o.Cat {
			return
		}
		if o.Keep != nil && !o.Keep(p) {
			return
		}
		if len(terms) > 1 { // words were matched one by one; the query may span words ("דק דק")
			for _, t := range terms {
				if !strings.Contains(p.Key, t) {
					return
				}
			}
		}
		pi := p.PriceInfo(o.Active)
		if pi.Lo < 0 && p.ListedAt(o.Active) < 0 {
			return
		}
		out = append(out, Hit{p, pi})
	}
	if len(terms) == 0 {
		for _, p := range ix.Products {
			check(p)
		}
	} else {
		for _, i := range cand {
			check(ix.Products[i])
		}
	}
	priced := func(h Hit) int {
		if h.PI.Lo < 0 {
			return 1
		}
		return 0
	}
	switch o.Sort {
	case "cheap":
		sort.SliceStable(out, func(a, b int) bool {
			if priced(out[a]) != priced(out[b]) {
				return priced(out[a]) < priced(out[b])
			}
			return out[a].PI.Lo < out[b].PI.Lo
		})
	case "gap":
		gap := func(h Hit) float64 {
			if h.PI.Lo <= 0 {
				return 0
			}
			return float64(h.PI.Hi) / float64(h.PI.Lo)
		}
		sort.SliceStable(out, func(a, b int) bool { return gap(out[a]) > gap(out[b]) })
	case "unit":
		sort.SliceStable(out, func(a, b int) bool {
			ua, oka := out[a].Unit()
			ub, okb := out[b].Unit()
			if oka != okb {
				return oka
			}
			if !oka {
				return false
			}
			if ua.Kind != ub.Kind {
				return ua.Kind < ub.Kind
			}
			return ua.Agorot < ub.Agorot
		})
	default: // popular: sold in more branches first; a name starting with the query first
		first := ""
		if len(terms) > 0 {
			first = terms[0]
		}
		sort.SliceStable(out, func(a, b int) bool {
			if first != "" {
				sa, sb := strings.HasPrefix(out[a].P.Key, first), strings.HasPrefix(out[b].P.Key, first)
				if sa != sb {
					return sa
				}
			}
			if out[a].P.Picks != nil != (out[b].P.Picks != nil) {
				return out[a].P.Picks != nil
			}
			return out[a].PI.N > out[b].PI.N
		})
	}
	return out
}

// Unit is the hit's unit price at its cheapest price.
func (h Hit) Unit() (UnitPrice, bool) {
	if h.PI.Lo <= 0 {
		return UnitPrice{}, false
	}
	if h.P.Weighted {
		return UnitPrice{Weight, float64(h.PI.Lo) / 10}, true // per kg -> per 100 g
	}
	z, ok := SizeOf(h.P)
	return UnitPriceOf(z, ok, float64(h.PI.Lo))
}

// candidates: the products with a word containing t, sorted. A short t scans more of the vocabulary.
func (ix *Index) candidates(t string) []int32 {
	var lists [][]int32
	n := 0
	for _, w := range ix.vocab {
		if strings.Contains(w, t) {
			l := ix.words[w]
			lists = append(lists, l)
			n += len(l)
		}
	}
	if len(lists) == 1 {
		return lists[0]
	}
	out := make([]int32, 0, n)
	for _, l := range lists {
		out = append(out, l...)
	}
	slices.Sort(out)
	return slices.Compact(out)
}

func intersect(a, b []int32) []int32 {
	out := make([]int32, 0, min(len(a), len(b)))
	i, j := 0, 0
	for i < len(a) && j < len(b) {
		switch {
		case a[i] < b[j]:
			i++
		case a[i] > b[j]:
			j++
		default:
			out = append(out, a[i])
			i++
			j++
		}
	}
	return out
}

// Promos at store i for the product that haven't ended (club ones included).
func (ix *Index) Promos(i int, code string, now time.Time) []core.Promo {
	var out []core.Promo
	for _, pr := range ix.promos[i][code] {
		if end, ok := Stamp(pr.End); ok && end.Before(now) {
			continue
		}
		out = append(out, pr)
	}
	return out
}

// Notes: conditional promotions at store i for the product that haven't ended.
func (ix *Index) Notes(i int, code string, now time.Time) []core.PromoNote {
	var out []core.PromoNote
	for _, n := range ix.notes[i][code] {
		if end, ok := Stamp(n.End); ok && end.Before(now) {
			continue
		}
		out = append(out, n)
	}
	return out
}

// Stamp parses "202611302359" (the chains' local time).
func Stamp(s string) (time.Time, bool) {
	if len(s) < 12 {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation("200601021504", s[:12], israel)
	return t, err == nil
}

var israel = func() *time.Location {
	if l, err := time.LoadLocation("Asia/Jerusalem"); err == nil {
		return l
	}
	return time.FixedZone("IST", 2*3600)
}()

// StoreName: "שופרסל · רמת גן מרכז".
func (ix *Index) StoreName(i int) string {
	if i < 0 || i >= len(ix.Stores) {
		return ""
	}
	s := ix.Stores[i]
	if s.Branch == "" {
		return s.Chain
	}
	return s.Chain + " · " + s.Branch
}
