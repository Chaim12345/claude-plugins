package shop

import (
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
)

// Deal is one promotion on one product at one chain, measured against the cheapest regular price
// among the active branches (dealsFeed.ts DealItem).
type Deal struct {
	ID         string
	P          *Product
	Chain      string // portal key
	ChainLabel string
	Promo      core.Promo
	Stores     []int // branches running it
	Rep        int   // the branch it is cheapest at
	Qty        int   // units the deal needs
	Unit       float64
	Shelf      float64 // shelf price per unit at Rep
	Cheapest   float64 // cheapest shelf price among active branches
	CheapestAt int
	Compared   int     // active branches selling the product
	SavePct    float64 // vs own shelf
	SaveAgorot int     // for Qty units, vs own shelf
	RealPct    float64 // vs the cheapest shelf anywhere
	RealAgorot int     // for Qty units, vs the cheapest shelf
	Verdict    string  // "real", "notCheapest", "alone"
	End        time.Time
	HasEnd     bool
	Confidence string // "ok" or "check"
	Why        string // why "check", in Hebrew
	AI         string // the model's answer: "yes", "no", "unclear" ("" = not asked)
}

const openEnded = 180 * 24 * time.Hour

var stockUpCats = map[string]bool{"pantry": true, "cleaning": true, "care": true, "drinks": true, "frozen": true, "pets": true, "snacks": true}
var perishable = map[string]bool{"dairy": true, "bakery": true, "produce": true, "meat": true}

// BuildDeals lists every promotion of the active branches as deals (dealsFeed.ts buildDeals).
func (ix *Index) BuildDeals(active []int, club Club, now time.Time) []*Deal {
	out := map[string]*Deal{}
	var order []string
	for _, i := range active {
		if i >= len(ix.Cat.Promos) {
			continue
		}
		ck := ix.Chains[i]
		label := ix.Stores[i].Chain
		if ck == "shufersal" {
			label = "שופרסל"
		}
		for _, pr := range ix.Cat.Promos[i] {
			end, hasEnd := Stamp(pr.End)
			if hasEnd && end.Before(now) {
				continue
			}
			if hasEnd && end.Sub(now) > openEnded {
				hasEnd = false
			}
			if pr.Club && !club[ck] {
				continue
			}
			qty := 1
			if pr.Kind == "bundle" {
				qty = max(1, pr.MinQty)
			}
			spread := -1.0
			for _, code := range pr.Codes {
				p := ix.ByCode[code]
				if p == nil || p.Weighted || p.Prices[i] < 0 {
					continue
				}
				shelf := float64(p.Prices[i])
				unit := DealUnit(pr, shelf)
				if !(unit < shelf-1e-9) || !(unit > 0) {
					continue
				}
				id := strings.Join([]string{ck, code, pr.Kind, ftoa(pr.Value), strconv.Itoa(pr.MinQty), btoa(pr.Club), strconv.Itoa(pr.Max), pr.End}, "|")
				if prev := out[id]; prev != nil {
					prev.Stores = append(prev.Stores, i)
					if unit < prev.Unit-1e-9 {
						prev.Rep, prev.Unit, prev.Shelf = i, unit, shelf
					}
					continue
				}
				if spread < 0 {
					spread = ix.promoSpread(pr, i)
				}
				d := &Deal{ID: id, P: p, Chain: ck, ChainLabel: label, Promo: pr, Stores: []int{i}, Rep: i, Qty: qty, Unit: unit, Shelf: shelf, End: end, HasEnd: hasEnd, Confidence: "ok"}
				if spread >= 2.5 {
					d.Why = "spread"
				}
				out[id] = d
				order = append(order, id)
			}
		}
	}
	items := make([]*Deal, 0, len(order))
	for _, id := range order {
		d := out[id]
		pi := d.P.PriceInfo(active)
		d.Cheapest, d.CheapestAt, d.Compared = float64(pi.Lo), pi.At, pi.N
		d.SavePct = (1 - d.Unit/d.Shelf) * 100
		d.SaveAgorot = round((d.Shelf - d.Unit) * float64(d.Qty))
		if d.Cheapest > 0 {
			d.RealPct = (1 - d.Unit/d.Cheapest) * 100
			d.RealAgorot = round((d.Cheapest - d.Unit) * float64(d.Qty))
		}
		switch {
		case d.Compared < 2:
			d.Verdict = "alone"
		case d.Unit < d.Cheapest-1e-9:
			d.Verdict = "real"
		default:
			d.Verdict = "notCheapest"
		}
		switch {
		case d.Why == "spread":
			d.Confidence, d.Why = "check", "המבצע רשום על כמה מוצרים במחירים שונים מאוד"
		case !NamesProduct(d.Promo.Desc, d.P.Name) && len(d.Promo.Codes) >= 2:
			d.Confidence, d.Why = "check", "נוסח המבצע: ״"+d.Promo.Desc+"״"
		case d.RealPct > 60:
			d.Confidence, d.Why = "check", "הנחה חריגה במיוחד"
		default:
			d.Why = ""
		}
		items = append(items, d)
	}
	return items
}

func (ix *Index) promoSpread(pr core.Promo, i int) float64 {
	if len(pr.Codes) < 2 {
		return 1
	}
	lo, hi := math.Inf(1), 0.0
	for _, code := range pr.Codes {
		if p := ix.ByCode[code]; p != nil && p.Prices[i] >= 0 {
			v := float64(p.Prices[i])
			lo, hi = math.Min(lo, v), math.Max(hi, v)
		}
	}
	if math.IsInf(lo, 1) || lo <= 0 {
		return 1
	}
	return hi / lo
}

var generic = map[string]bool{}

func init() {
	for _, w := range strings.Fields("מבצע מבצעים הנחה מחיר מוצרים מוצר מגוון בטעמים טעמים שונים סוגים במבחר מבחר יחידות ליחידה כולל פקדון פיקדון מועדון חברי לקוחות קנה קבל מתנה בלבד") {
		generic[w] = true
	}
}

func wordsOf(s string) []string {
	s = strings.Map(func(r rune) rune {
		if strings.ContainsRune("\"'׳״`.,()-+/*", r) {
			return ' '
		}
		return r
	}, s)
	var out []string
	for _, w := range strings.Fields(s) {
		if len([]rune(w)) < 3 || strings.ContainsAny(w, "0123456789") || generic[w] {
			continue
		}
		out = append(out, stem(w))
	}
	return out
}

func stem(w string) string {
	r := []rune(w)
	if len(r) >= 4 && strings.ContainsRune("והבלמש", r[0]) {
		return string(r[1:])
	}
	return w
}

// NamesProduct: does the promotion's text mention the product (a word in common, Hebrew endings aside)?
func NamesProduct(desc, name string) bool {
	d := wordsOf(desc)
	if len(d) == 0 {
		return true
	}
	n := wordsOf(name)
	head := func(w string) string {
		r := []rune(w)
		if len(r) > 4 {
			r = r[:4]
		}
		return string(r)
	}
	for _, w := range d {
		for _, x := range n {
			if strings.Contains(x, w) || strings.Contains(w, x) || (len([]rune(w)) >= 4 && len([]rune(x)) >= 4 && head(w) == head(x)) {
				return true
			}
		}
	}
	return false
}

// OnePerChainProduct keeps the cheapest deal per (chain, product).
func OnePerChainProduct(all []*Deal) []*Deal {
	best := map[string]*Deal{}
	var keys []string
	for _, d := range all {
		k := d.Chain + "|" + d.P.Code
		if b := best[k]; b == nil {
			keys = append(keys, k)
			best[k] = d
		} else if d.Unit < b.Unit-1e-9 {
			best[k] = d
		}
	}
	out := make([]*Deal, len(keys))
	for i, k := range keys {
		out[i] = best[k]
	}
	return out
}

// Score: how useful a deal is to this shopper (dealsFeed.ts dealScore).
func (d *Deal) Score(mine map[string]bool, now time.Time) float64 {
	if d.Verdict == "notCheapest" {
		return 0
	}
	save := float64(d.SaveAgorot) * 0.5
	if d.Verdict == "real" {
		save = float64(d.RealAgorot)
	}
	s := math.Log1p(math.Max(0, save)/100) * (1 + math.Max(0, d.RealPct)/100)
	if mine[d.P.Code] {
		s *= 2
	}
	if d.Confidence == "check" {
		s *= 0.5
	}
	if d.Qty >= 3 && perishable[d.P.Cat] {
		s *= 0.7
	}
	if d.EndingSoon(now) {
		s *= 1.15
	}
	return s
}

// EndingSoon: ends within 48 hours.
func (d *Deal) EndingSoon(now time.Time) bool {
	return d.HasEnd && !d.End.Before(now) && d.End.Sub(now) <= 48*time.Hour
}

// EndLabel: "עד היום", "עד 14.11", or "" for no end date.
func (d *Deal) EndLabel(now time.Time) string {
	if !d.HasEnd {
		return ""
	}
	e := d.End.In(israel)
	n := now.In(israel)
	if e.YearDay() == n.YearDay() && e.Year() == n.Year() {
		return "עד היום"
	}
	return "עד " + strconv.Itoa(e.Day()) + "." + strconv.Itoa(int(e.Month()))
}

// DealFilter selects and orders deals for the deals screen.
type DealFilter struct {
	Cat, Chain string
	OnlyReal   bool
	MinSave    int    // agorot
	Sort       string // "useful", "save", "pct", "ending", "unit"
	Mine       map[string]bool
}

func FilterDeals(all []*Deal, f DealFilter, now time.Time) []*Deal {
	var out []*Deal
	for _, d := range OnePerChainProduct(all) {
		if d.AI == "no" {
			continue
		}
		if f.Cat != "" && f.Cat != "all" && d.P.Cat != f.Cat {
			continue
		}
		if f.Chain != "" && f.Chain != "all" && d.Chain != f.Chain {
			continue
		}
		if f.OnlyReal && d.Verdict != "real" {
			continue
		}
		save := d.SaveAgorot
		if d.Verdict == "real" {
			save = d.RealAgorot
		}
		if save < f.MinSave {
			continue
		}
		out = append(out, d)
	}
	pct := func(d *Deal) float64 { return d.RealPct }
	switch f.Sort {
	case "save":
		sort.SliceStable(out, func(a, b int) bool { return out[a].RealAgorot > out[b].RealAgorot })
	case "pct":
		sort.SliceStable(out, func(a, b int) bool { return pct(out[a]) > pct(out[b]) })
	case "ending":
		sort.SliceStable(out, func(a, b int) bool {
			if out[a].HasEnd != out[b].HasEnd {
				return out[a].HasEnd
			}
			return out[a].End.Before(out[b].End)
		})
	default:
		sort.SliceStable(out, func(a, b int) bool { return out[a].Score(f.Mine, now) > out[b].Score(f.Mine, now) })
	}
	return out
}

// BestOfWeek: real, trusted deals with the deepest discount, at most perCat per category and one
// per product and promotion.
func BestOfWeek(all []*Deal, n, perCat int) []*Deal {
	pool := []*Deal{}
	for _, d := range OnePerChainProduct(all) {
		if d.Verdict == "real" && d.Confidence == "ok" && d.AI != "no" && d.RealAgorot >= 100 {
			pool = append(pool, d)
		}
	}
	sort.SliceStable(pool, func(a, b int) bool { return pool[a].RealPct > pool[b].RealPct })
	seen, promos, cats := map[string]bool{}, map[string]bool{}, map[string]int{}
	var out []*Deal
	for _, d := range pool {
		pk := d.Chain + "|" + d.Promo.ID
		if seen[d.P.Code] || promos[pk] || cats[d.P.Cat] >= perCat {
			continue
		}
		seen[d.P.Code], promos[pk] = true, true
		cats[d.P.Cat]++
		out = append(out, d)
		if len(out) >= n {
			break
		}
	}
	return out
}

// StockUp: things that keep, 20%+ under the cheapest regular price and worth ₪3+.
func StockUp(all []*Deal, n int) []*Deal {
	var pool []*Deal
	for _, d := range OnePerChainProduct(all) {
		if d.Verdict == "real" && d.Confidence == "ok" && d.AI != "no" && stockUpCats[d.P.Cat] && d.RealPct >= 20 && d.RealAgorot >= 300 {
			pool = append(pool, d)
		}
	}
	sort.SliceStable(pool, func(a, b int) bool { return pool[a].RealAgorot > pool[b].RealAgorot })
	return onePerProduct(pool, n)
}

func onePerProduct(l []*Deal, n int) []*Deal {
	seen := map[string]bool{}
	var out []*Deal
	for _, d := range l {
		if seen[d.P.Code] {
			continue
		}
		seen[d.P.Code] = true
		out = append(out, d)
		if len(out) >= n {
			break
		}
	}
	return out
}

func ftoa(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }
func btoa(b bool) string {
	if b {
		return "1"
	}
	return "0"
}
