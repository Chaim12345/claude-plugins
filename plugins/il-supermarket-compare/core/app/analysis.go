package app

import (
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/shop"
)

// Analysis over the classified catalog (mobile/src/lib/analysis.ts): each product is compared with the
// median unit price of its own product type, so a cheese brand is measured against cheese.

type priced struct {
	p     *shop.Product
	typ   string
	brand string
	own   bool
	unit  shop.UnitPrice
	at    int
}

type TypeRow struct {
	Type    string `json:"type"`
	N       int    `json:"n"`
	Brands  int    `json:"brands"`
	Code    string `json:"code"` // the cheapest per unit
	Name    string `json:"name"`
	Unit    string `json:"unit"`
	SavePct int    `json:"savePct"` // under the type's median
	Median  string `json:"median"`
	Where   string `json:"where"`
}

type BrandRow struct {
	Brand string `json:"brand"`
	N     int    `json:"n"`
	Types int    `json:"types"`
	Pct   int    `json:"pct"` // vs typical for the same types; negative = cheaper
	Own   bool   `json:"own"`
}

type AnalysisView struct {
	Total      int        `json:"total"`
	Done       int        `json:"done"`
	Unsure     int        `json:"unsure"`
	BrandCount int        `json:"brandCount"`
	TypeCount  int        `json:"typeCount"`
	Cheap      []BrandRow `json:"cheap"`
	Dear       []BrandRow `json:"dear"`
	Own        []BrandRow `json:"own"` // a chain's own brand: Pct = % cheaper than national brands of the same types
	Types      []TypeRow  `json:"types"`
	Diets      []LabelN   `json:"diets"`
}

func median(xs []float64) float64 {
	s := append([]float64(nil), xs...)
	sort.Float64s(s)
	m := len(s) / 2
	if len(s)%2 == 1 {
		return s[m]
	}
	return (s[m-1] + s[m]) / 2
}

func (e *Engine) Analysis() AnalysisView {
	e.mu.RLock()
	defer e.mu.RUnlock()
	v := AnalysisView{Cheap: []BrandRow{}, Dear: []BrandRow{}, Own: []BrandRow{}, Types: []TypeRow{}, Diets: []LabelN{}}
	if e.ix == nil {
		return v
	}
	act := e.active()
	brands, types := map[string]bool{}, map[string]bool{}
	var xs []priced
	for _, p := range e.ix.Products {
		if strings.HasPrefix(p.Code, "f-") {
			continue
		}
		v.Total++
		r := p.AI
		if r == nil {
			continue
		}
		v.Done++
		if r.Q {
			v.Unsure++
			continue
		}
		if r.B != "" {
			brands[r.B] = true
		}
		types[r.T] = true
		h := shop.Hit{P: p, PI: p.PriceInfo(act)}
		if u, ok := h.Unit(); ok {
			xs = append(xs, priced{p, r.T, r.B, r.PL, u, h.PI.At})
		}
	}
	v.BrandCount, v.TypeCount = len(brands), len(types)
	key := func(x priced) string { return x.typ + "|" + strconv.Itoa(int(x.unit.Kind)) }
	groups := map[string][]priced{}
	for _, x := range xs {
		groups[key(x)] = append(groups[key(x)], x)
	}
	med := map[string]float64{}
	for k, l := range groups {
		if len(l) < 3 {
			continue
		}
		var a []float64
		bs := map[string]bool{}
		for _, x := range l {
			a = append(a, x.unit.Agorot)
			if x.brand != "" {
				bs[x.brand] = true
			}
		}
		m := median(a)
		med[k] = m
		best := l[0]
		for _, x := range l {
			if x.unit.Agorot < best.unit.Agorot {
				best = x
			}
		}
		v.Types = append(v.Types, TypeRow{Type: best.typ, N: len(l), Brands: len(bs), Code: best.p.Code, Name: best.p.Name, Unit: best.unit.Text(),
			SavePct: int(math.Round((1 - best.unit.Agorot/m) * 100)), Median: shop.Money(m), Where: e.ix.StoreName(best.at)})
	}
	sort.SliceStable(v.Types, func(a, b int) bool { return v.Types[a].N > v.Types[b].N })
	// brands: geometric mean of unit price / type median, 5+ products in 2+ types
	type acc struct {
		logs  []float64
		types map[string]bool
		own   int
	}
	by := map[string]*acc{}
	nat := map[string][]float64{} // national brands' unit prices per type
	for _, x := range xs {
		m, ok := med[key(x)]
		if !ok || x.brand == "" {
			continue
		}
		a := by[x.brand]
		if a == nil {
			a = &acc{types: map[string]bool{}}
			by[x.brand] = a
		}
		a.logs = append(a.logs, math.Log(x.unit.Agorot/m))
		a.types[x.typ] = true
		if x.own {
			a.own++
		} else {
			nat[key(x)] = append(nat[key(x)], x.unit.Agorot)
		}
	}
	var all []BrandRow
	for b, a := range by {
		if len(a.logs) < 5 || len(a.types) < 2 {
			continue
		}
		sum := 0.0
		for _, l := range a.logs {
			sum += l
		}
		all = append(all, BrandRow{Brand: b, N: len(a.logs), Types: len(a.types), Pct: int(math.Round((math.Exp(sum/float64(len(a.logs))) - 1) * 100)), Own: a.own*2 > len(a.logs)})
	}
	sort.SliceStable(all, func(a, b int) bool { return all[a].Pct < all[b].Pct })
	for _, r := range all {
		if r.Pct < 0 && len(v.Cheap) < 15 {
			v.Cheap = append(v.Cheap, r)
		}
	}
	for i := len(all) - 1; i >= 0; i-- {
		if all[i].Pct > 0 && len(v.Dear) < 15 {
			v.Dear = append(v.Dear, all[i])
		}
	}
	// own brands vs national brands of the same type (median saving)
	ownSave := map[string][]float64{}
	for _, x := range xs {
		l := nat[key(x)]
		if !x.own || len(l) < 2 {
			continue
		}
		ownSave[x.brand] = append(ownSave[x.brand], (1-x.unit.Agorot/median(l))*100)
	}
	for b, l := range ownSave {
		if len(l) >= 5 {
			v.Own = append(v.Own, BrandRow{Brand: b, N: len(l), Pct: int(math.Round(median(l))), Own: true})
		}
	}
	sort.SliceStable(v.Own, func(a, b int) bool { return v.Own[a].Pct > v.Own[b].Pct })
	v.Diets = e.dietCounts()
	return v
}
