package shop

import (
	"math"
	"sort"
	"time"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
)

// Club: the chains (portal keys) whose club prices the user can get.
type Club map[string]bool

// PromoCost: q units at shelf price unit under one promotion, in agorot. Units beyond its limit, and
// bundle remainders, are at shelf price.
func PromoCost(pr core.Promo, unit, q float64) float64 {
	cp := q
	if pr.Max > 0 {
		cp = math.Min(q, float64(pr.Max))
	}
	rest := (q - cp) * unit
	switch pr.Kind {
	case "price":
		return rest + cp*pr.Value
	case "percent":
		return rest + cp*unit*(1-pr.Value/100)
	}
	minQ := float64(max(pr.MinQty, 1))
	n := math.Floor(cp / minQ)
	return rest + n*pr.Value + (cp-n*minQ)*unit
}

// DealUnit: the price of one unit when the promotion applies, in agorot.
func DealUnit(pr core.Promo, shelf float64) float64 {
	switch pr.Kind {
	case "price":
		return pr.Value
	case "percent":
		return shelf * (1 - pr.Value/100)
	}
	return pr.Value / float64(max(pr.MinQty, 1))
}

// DealText: "2 ב־10.00 ₪", "8.90 ₪", "20% הנחה".
func DealText(pr core.Promo) string {
	switch pr.Kind {
	case "bundle":
		return itoa(pr.MinQty) + " ב־" + Money(pr.Value) + " ₪"
	case "price":
		return Money(pr.Value) + " ₪"
	}
	return trimFloat(pr.Value) + "% הנחה"
}

// Usable: promotions the user can use at store i now (club ones only with that chain's card).
func (ix *Index) Usable(i int, code string, club Club, now time.Time) []core.Promo {
	var out []core.Promo
	for _, pr := range ix.Promos(i, code, now) {
		if !pr.Club || club[ix.Chains[i]] {
			out = append(out, pr)
		}
	}
	return out
}

// Priced is the cost of q units at a store: the best usable promotion, or the shelf price.
type Priced struct {
	Cost, Shelf float64
	Promo       *core.Promo
}

// PriceAt: q units of p at store i; ok is false when the store doesn't sell it.
func (ix *Index) PriceAt(p *Product, i int, q float64, club Club, now time.Time) (Priced, bool) {
	unit := p.Prices[i]
	if unit < 0 {
		return Priced{}, false
	}
	shelf := float64(unit) * q
	best := Priced{shelf, shelf, nil}
	if p.Weighted {
		return best, true // fresh items are matched by name; promotions are by barcode
	}
	for _, pr := range ix.Usable(i, p.Code, club, now) {
		if c := PromoCost(pr, float64(unit), q); c < best.Cost-1e-9 {
			pr := pr
			best = Priced{c, shelf, &pr}
		}
	}
	return best, true
}

// BestDeal: the promotion with the lowest unit price among the active stores, for badges.
type BestDeal struct {
	Store       int
	Promo       core.Promo
	Unit, Shelf float64
}

func (ix *Index) BestDeal(p *Product, active []int, club Club, now time.Time) (BestDeal, bool) {
	var best BestDeal
	found := false
	if p.Weighted {
		return best, false
	}
	for _, i := range active {
		shelf := p.Prices[i]
		if shelf < 0 {
			continue
		}
		for _, pr := range ix.Usable(i, p.Code, club, now) {
			u := DealUnit(pr, float64(shelf))
			if u < float64(shelf) && (!found || u < best.Unit) {
				best, found = BestDeal{i, pr, u, float64(shelf)}, true
			}
		}
	}
	return best, found
}

// StoreTotal is one store's basket.
type StoreTotal struct {
	Store     int      `json:"store"`
	Total     int      `json:"total"`     // with promotions, agorot
	Shelf     int      `json:"shelf"`     // the same items at shelf prices
	Fair      int      `json:"fair"`      // like-for-like (items every store sells), with promotions
	FairShelf int      `json:"fairShelf"` // like-for-like at shelf prices
	Deals     int      `json:"deals"`     // items that get a promotion here
	Missing   []string `json:"missing"`
	Doubt     []string `json:"doubt"` // priced, but not sold for a month: may not be on the shelf
}

// Line is one cart item at its cheapest active store.
type Line struct {
	P     *Product
	Q     float64
	Store int // -1 = sold nowhere active
	Cost  float64
	Shelf float64
	Promo *core.Promo
}

// Comparison is the basket compared across the active stores (compare.ts compare()).
type Comparison struct {
	Lines       []Line
	Rows        []StoreTotal // fewest missing items first, then cheapest
	Common      int          // items every active store sells
	FairLow     int
	Split       int // the cheapest store per item
	SplitShelf  int
	SplitStores int
}

// Compare prices a cart (code -> quantity) at every active store.
func (ix *Index) Compare(cart map[string]float64, active []int, club Club, now time.Time) Comparison {
	type item struct {
		p *Product
		q float64
	}
	var items []item
	codes := make([]string, 0, len(cart))
	for c := range cart {
		codes = append(codes, c)
	}
	sort.Strings(codes)
	for _, c := range codes {
		if p := ix.ByCode[c]; p != nil && cart[c] > 0 {
			items = append(items, item{p, cart[c]})
		}
	}
	var common []item
	for _, it := range items {
		all := true
		for _, i := range active {
			if it.p.Prices[i] < 0 {
				all = false
				break
			}
		}
		if all {
			common = append(common, it)
		}
	}
	var cmp Comparison
	for _, i := range active {
		var total, shelf, fair, fairShelf float64
		r := StoreTotal{Store: i, Missing: []string{}, Doubt: []string{}}
		for _, it := range items {
			pr, ok := ix.PriceAt(it.p, i, it.q, club, now)
			if !ok {
				r.Missing = append(r.Missing, it.p.Name)
				continue
			}
			total += pr.Cost
			shelf += pr.Shelf
			if pr.Promo != nil {
				r.Deals++
			}
			if it.p.IsStale(i) {
				r.Doubt = append(r.Doubt, it.p.Name)
			}
		}
		for _, it := range common {
			pr, _ := ix.PriceAt(it.p, i, it.q, club, now)
			fair += pr.Cost
			fairShelf += pr.Shelf
		}
		r.Total, r.Shelf, r.Fair, r.FairShelf = round(total), round(shelf), round(fair), round(fairShelf)
		cmp.Rows = append(cmp.Rows, r)
	}
	sort.SliceStable(cmp.Rows, func(a, b int) bool {
		if len(cmp.Rows[a].Missing) != len(cmp.Rows[b].Missing) {
			return len(cmp.Rows[a].Missing) < len(cmp.Rows[b].Missing)
		}
		return cmp.Rows[a].Total < cmp.Rows[b].Total
	})
	used := map[int]bool{}
	var split, splitShelf float64
	for _, it := range items {
		ln := Line{P: it.p, Q: it.q, Store: -1}
		lowShelf := -1.0
		for _, i := range active {
			pr, ok := ix.PriceAt(it.p, i, it.q, club, now)
			if !ok {
				continue
			}
			if ln.Store < 0 || pr.Cost < ln.Cost {
				ln.Store, ln.Cost, ln.Shelf, ln.Promo = i, pr.Cost, pr.Shelf, pr.Promo
			}
			if lowShelf < 0 || pr.Shelf < lowShelf {
				lowShelf = pr.Shelf
			}
		}
		cmp.Lines = append(cmp.Lines, ln)
		if ln.Store >= 0 {
			split += ln.Cost
			splitShelf += lowShelf
			used[ln.Store] = true
		}
	}
	cmp.Common = len(common)
	for k, r := range cmp.Rows {
		if k == 0 || r.Fair < cmp.FairLow {
			cmp.FairLow = r.Fair
		}
	}
	cmp.Split, cmp.SplitShelf, cmp.SplitStores = round(split), round(splitShelf), len(used)
	return cmp
}

func round(x float64) int { return int(math.Round(x)) }

func itoa(n int) string { return trimFloat(float64(n)) }

func trimFloat(x float64) string {
	s := Money(x * 100)
	for len(s) > 0 && s[len(s)-1] == '0' {
		s = s[:len(s)-1]
	}
	if len(s) > 0 && s[len(s)-1] == '.' {
		s = s[:len(s)-1]
	}
	return s
}
