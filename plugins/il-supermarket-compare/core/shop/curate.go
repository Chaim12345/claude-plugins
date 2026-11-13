package shop

import (
	"maps"
	"regexp"
	"sort"
	"strings"
)

// Curation is the user's catalog tidying (mobile/src/lib/curate.ts): names the model cleaned, and
// products merged because they are the same product under two barcodes. Applied on the phone on top
// of the price files; every change can be undone.
type Curation struct {
	Names    map[string]string `json:"names"`    // code -> clean name
	Links    map[string]string `json:"links"`    // secondary code -> primary code
	Approved map[string]bool   `json:"approved"` // links the user approved (secondary code)
	Rejected map[string]bool   `json:"rejected"` // "names:code" or "links:code": undone
	Asked    map[string]bool   `json:"asked"`    // "names:code", "links:a|b": answered already
	AutoLink bool              `json:"autoLink"` // merge without waiting for approval
}

func NewCuration() *Curation {
	return &Curation{Names: map[string]string{}, Links: map[string]string{}, Approved: map[string]bool{}, Rejected: map[string]bool{}, Asked: map[string]bool{}}
}

// Fill makes every map non-nil (after reading a saved state that lacks some).
func (c *Curation) Fill() {
	if c.Names == nil {
		c.Names = map[string]string{}
	}
	if c.Links == nil {
		c.Links = map[string]string{}
	}
	if c.Approved == nil {
		c.Approved = map[string]bool{}
	}
	if c.Rejected == nil {
		c.Rejected = map[string]bool{}
	}
	if c.Asked == nil {
		c.Asked = map[string]bool{}
	}
}

// Clone is a copy that can be read while the original keeps changing.
func (c *Curation) Clone() *Curation {
	n := NewCuration()
	n.AutoLink = c.AutoLink
	maps.Copy(n.Names, c.Names)
	maps.Copy(n.Links, c.Links)
	maps.Copy(n.Approved, c.Approved)
	maps.Copy(n.Rejected, c.Rejected)
	maps.Copy(n.Asked, c.Asked)
	return n
}

// LinkActive: approved (or auto), not undone.
func (c *Curation) LinkActive(s string) bool {
	return c != nil && c.Links[s] != "" && !c.Rejected["links:"+s] && (c.AutoLink || c.Approved[s])
}

func PairKey(a, b string) string {
	if a < b {
		return a + "|" + b
	}
	return b + "|" + a
}

func disjoint(a, b []int32) bool {
	for i := range a {
		if a[i] >= 0 && i < len(b) && b[i] >= 0 {
			return false
		}
	}
	return true
}

// applyCuration renames and merges products in place; returns the merged-away codes -> primary.
func (ix *Index) applyCuration(c *Curation) map[string]string {
	alias := map[string]string{}
	if c == nil {
		return alias
	}
	for code, name := range c.Names {
		if p := ix.ByCode[code]; p != nil && !c.Rejected["names:"+code] && strings.TrimSpace(name) != "" && name != p.Name {
			if p.RawName == "" {
				p.RawName = p.Name
			}
			p.Name = name
		}
	}
	for s, pc := range c.Links {
		if !c.LinkActive(s) || c.Links[pc] != "" {
			continue
		}
		a, b := ix.ByCode[s], ix.ByCode[pc]
		if a == nil || b == nil || !disjoint(a.Prices, b.Prices) {
			continue
		}
		for i, v := range a.Prices {
			if v >= 0 {
				b.Prices[i] = v
				if d, ok := a.Stale[i]; ok {
					if b.Stale == nil {
						b.Stale = map[int]int{}
					}
					b.Stale[i] = d
				}
				if d, ok := a.Chg[i]; ok {
					if b.Chg == nil {
						b.Chg = map[int]int{}
					}
					b.Chg[i] = d
				}
			}
		}
		if b.Img == "" {
			b.Img = a.Img
		}
		b.Linked = append(b.Linked, s)
		alias[s] = pc
		delete(ix.ByCode, s)
	}
	if len(alias) > 0 {
		out := ix.Products[:0]
		for _, p := range ix.Products {
			if _, gone := alias[p.Code]; !gone {
				out = append(out, p)
			}
		}
		ix.Products = out
	}
	ix.Alias = alias
	return alias
}

// ---------------------------------------------------------------- candidates

var messyRx = []*regexp.Regexp{
	regexp.MustCompile(`[\x{05D0}-\x{05EA}]\d|\d[\x{05D0}-\x{05EA}]`), // a size glued to a word
	regexp.MustCompile(`[\x{05D0}-\x{05EA}]\.[\x{05D0}-\x{05EA}]`),    // ש.חלב
	regexp.MustCompile(`[\x{200E}\x{200F}\x{202A}-\x{202E}]`),         // direction marks
	regexp.MustCompile(`\s[\x{05D0}-\x{05EA}]$`),                      // cut off
	regexp.MustCompile(`\s{2,}`),
}

// MessyName: a name worth cleaning.
func MessyName(n string) bool {
	for _, r := range messyRx {
		if r.MatchString(n) {
			return true
		}
	}
	return false
}

// NameCandidates: messy names not asked about yet.
func (ix *Index) NameCandidates(c *Curation) []*Product {
	var out []*Product
	for _, p := range ix.Products {
		if p.RawName == "" && !c.Asked["names:"+p.Code] && c.Names[p.Code] == "" && MessyName(p.Name) && !strings.HasPrefix(p.Code, "f-") {
			out = append(out, p)
		}
	}
	return out
}

// LinkPair is a possible duplicate: A (sold in fewer chains) may be B under another barcode.
type LinkPair struct {
	A, B  *Product
	Score float64
}

var numRx = regexp.MustCompile(`\d+`)
var stopWords = map[string]bool{"גרם": true, "גר": true, "ג": true, "מל": true, "ליטר": true, "ל": true, "יח": true, "יחידות": true, "קג": true, "ק": true, "בטעם": true, "טעם": true, "עם": true, "של": true, "מארז": true, "אריזה": true, "חדש": true, "מבצע": true}

func linkWords(name string) (heads map[string]bool, nums map[string]bool) {
	heads, nums = map[string]bool{}, map[string]bool{}
	s := Norm(name)
	s = strings.Map(func(r rune) rune {
		if (r >= 'א' && r <= 'ת') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		return ' '
	}, s)
	// split digits from letters: "200גרם" -> "200 גרם"
	var b strings.Builder
	prevDigit := false
	for i, r := range s {
		d := r >= '0' && r <= '9'
		if i > 0 && d != prevDigit && r != ' ' {
			b.WriteRune(' ')
		}
		b.WriteRune(r)
		prevDigit = d
	}
	for _, w := range strings.Fields(b.String()) {
		if stopWords[w] {
			continue
		}
		if numRx.MatchString(w) && strings.Trim(w, "0123456789") == "" {
			nums[w] = true
			continue
		}
		r := []rune(w)
		if len(r) > 4 {
			r = r[:4]
		}
		heads[string(r)] = true
	}
	return
}

// LinkCandidates: pairs with the same pack size, no branch selling both, the same numbers and most
// name words in common; each product proposed at most twice, best first.
func (ix *Index) LinkCandidates(c *Curation, limit int) []LinkPair {
	type cand struct {
		p      *Product
		h, n   map[string]bool
		chains int
	}
	buckets := map[string][]cand{}
	for _, p := range ix.Products {
		if p.Weighted || c.Links[p.Code] != "" || strings.Contains(p.Code, ":") {
			continue
		}
		z, ok := SizeOf(p)
		if !ok {
			continue
		}
		k := string(rune('0'+z.Kind)) + ":" + strings.TrimRight(strings.TrimRight(Money(z.Amount*100), "0"), ".")
		h, n := linkWords(p.Name)
		ch := map[string]bool{}
		for i, v := range p.Prices {
			if v >= 0 {
				ch[ix.Chains[i]] = true
			}
		}
		buckets[k] = append(buckets[k], cand{p, h, n, len(ch)})
	}
	var out []LinkPair
	for _, l := range buckets {
		if len(l) < 2 {
			continue
		}
		byHead := map[string][]int{}
		for i, x := range l {
			for h := range x.h {
				byHead[h] = append(byHead[h], i)
			}
		}
		for i, x := range l {
			shared := map[int]int{}
			for h := range x.h {
				for _, j := range byHead[h] {
					if j > i {
						shared[j]++
					}
				}
			}
			for j, inter := range shared {
				if inter < 2 {
					continue
				}
				y := l[j]
				score := float64(inter) / float64(len(x.h)+len(y.h)-inter)
				if score < 0.5 || !disjoint(x.p.Prices, y.p.Prices) || (x.p.Cat != y.p.Cat && x.p.Cat != "other" && y.p.Cat != "other") {
					continue
				}
				if c.Asked["links:"+PairKey(x.p.Code, y.p.Code)] || !sameSet(x.n, y.n) {
					continue
				}
				if x.p.Maker != "" && y.p.Maker != "" && Norm(x.p.Maker) != Norm(y.p.Maker) {
					continue
				}
				a, b := x, y
				if y.chains < x.chains {
					a, b = y, x
				}
				out = append(out, LinkPair{a.p, b.p, score})
			}
		}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].Score > out[b].Score })
	seen := map[string]int{}
	var res []LinkPair
	for _, x := range out {
		if seen[x.A.Code]+seen[x.B.Code] >= 2 {
			continue
		}
		seen[x.A.Code]++
		seen[x.B.Code]++
		res = append(res, x)
		if len(res) >= limit {
			break
		}
	}
	return res
}

func sameSet(a, b map[string]bool) bool {
	if len(a) != len(b) {
		return false
	}
	for k := range a {
		if !b[k] {
			return false
		}
	}
	return true
}
