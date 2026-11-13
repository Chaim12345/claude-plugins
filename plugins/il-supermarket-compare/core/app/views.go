package app

import (
	"math"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/ai"
	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/shop"
)

// The screens' data. Field names are short and stable: the Kotlin side reads them by name.

type StoreView struct {
	ID     string  `json:"id"`
	I      int     `json:"i"`
	Chain  string  `json:"chain"`
	Key    string  `json:"key"` // portal key, for club cards
	Branch string  `json:"branch"`
	On     bool    `json:"on"`
	Km     float64 `json:"km"`   // -1 = unknown
	Club   bool    `json:"club"` // the chain has club promotions
}

type StatusView struct {
	Ready      bool            `json:"ready"`
	Building   bool            `json:"building"`
	Place      *Place          `json:"place"`
	Syncing    bool            `json:"syncing"`
	SyncMsg    string          `json:"syncMsg"`
	SyncErr    string          `json:"syncErr"`
	PriceDate  string          `json:"priceDate"`
	Products   int             `json:"products"`
	Stores     []StoreView     `json:"stores"`
	CartCount  int             `json:"cartCount"`
	Categories []core.Category `json:"categories"`
	ClubOwned  shop.Club       `json:"clubOwned"`
	AIOn       bool            `json:"aiOn"`
	AIRun      *aiStatus       `json:"aiRun"`
	Images     bool            `json:"images"`
}

func (e *Engine) km(s core.Store) float64 {
	if e.st.Place == nil || s.Lat == nil || s.Lon == nil {
		return -1
	}
	return math.Round(core.Km(e.st.Place.Lat, e.st.Place.Lon, *s.Lat, *s.Lon)*10) / 10
}

func (e *Engine) Status() StatusView {
	e.mu.RLock()
	defer e.mu.RUnlock()
	v := StatusView{Building: e.building, Place: e.st.Place, Syncing: e.syncing, SyncMsg: e.syncMsg, SyncErr: e.syncErr, CartCount: len(e.st.Cart),
		ClubOwned: e.st.Club, AIOn: e.st.AI.Usable(), AIRun: e.aiRun, Images: e.st.Images, Stores: []StoreView{}}
	if e.ix != nil {
		v.Ready, v.PriceDate, v.Products, v.Categories = true, newestStamp(e.ix.Cat), len(e.ix.Products), e.ix.Cat.Categories
		for i, s := range e.ix.Stores {
			club := false
			if i < len(e.ix.Cat.Promos) {
				for _, pr := range e.ix.Cat.Promos[i] {
					if pr.Club {
						club = true
						break
					}
				}
			}
			v.Stores = append(v.Stores, StoreView{ID: s.ID, I: i, Chain: s.Chain, Key: e.ix.Chains[i], Branch: s.Branch, On: !slices.Contains(e.st.Off, s.ID), Km: e.km(s), Club: club})
		}
	}
	return v
}

// newestStamp: "13.11 07:10", the newest price file.
func newestStamp(c *core.Catalog) string {
	best := ""
	for _, s := range c.Stores {
		if s.FileTime > best {
			best = s.FileTime
		}
	}
	if len(best) < 12 {
		return ""
	}
	d, _ := strconv.Atoi(best[6:8])
	m, _ := strconv.Atoi(best[4:6])
	return strconv.Itoa(d) + "." + strconv.Itoa(m) + " " + best[8:10] + ":" + best[10:12]
}

// ItemView is a product in a list.
type ItemView struct {
	Code     string  `json:"code"`
	Name     string  `json:"name"`
	Price    string  `json:"price"`    // "12.90", "" = no price
	Lo       int     `json:"lo"`       // agorot, -1 = none
	Where    string  `json:"where"`    // cheapest branch
	Branches int     `json:"branches"` // branches that sell it
	Unit     string  `json:"unit"`     // "2.40 ₪ ל־100 גרם"
	Deal     string  `json:"deal"`     // best deal: "2 ב־12.00 ₪ · רמי לוי"
	DealClub bool    `json:"dealClub"`
	Qty      float64 `json:"qty"`
	Weighted bool    `json:"weighted"`
	Img      string  `json:"img"`
	Stale    bool    `json:"stale"` // the cheapest branch hasn't sold it for a month
	Gap      int     `json:"gap"`   // % between cheapest and dearest
	Tags     string  `json:"tags"`  // the model's type · brand · diet
}

func (e *Engine) itemView(h shop.Hit, act []int, now time.Time) ItemView {
	p := h.P
	v := ItemView{Code: p.Code, Name: p.Name, Lo: int(h.PI.Lo), Branches: h.PI.N, Qty: e.st.Cart[p.Code], Weighted: p.Weighted}
	at := h.PI.At
	if h.PI.Lo >= 0 {
		v.Price = shop.Money(float64(h.PI.Lo))
		if h.PI.Hi > h.PI.Lo {
			v.Gap = int(math.Round((float64(h.PI.Hi)/float64(h.PI.Lo) - 1) * 100))
		}
		v.Stale = at >= 0 && p.IsStale(at)
	} else {
		at = p.ListedAt(act)
	}
	v.Where = e.ix.StoreName(at)
	if u, ok := h.Unit(); ok {
		v.Unit = u.Text()
	}
	if d, ok := e.ix.BestDeal(p, act, e.st.Club, now); ok {
		v.Deal, v.DealClub = shop.DealText(d.Promo)+" · "+e.ix.Stores[d.Store].Chain, d.Promo.Club
	}
	if e.st.Images {
		v.Img = e.imgURL(p)
	}
	if r := p.AI; r != nil {
		var t []string
		for _, d := range r.D {
			if d != "kosher" && d != "dairy" && d != "meat" && d != "parve" {
				t = append(t, shop.DietLabel[d])
			}
		}
		v.Tags = strings.Join(t, " · ")
	}
	return v
}

func (e *Engine) imgURL(p *shop.Product) string {
	if p.Img == "" || len(e.ix.Cat.Images) == 0 {
		return ""
	}
	return strings.ReplaceAll(e.ix.Cat.Images[0], "{code}", p.Img)
}

// SearchOpts from the products screen.
type SearchReq struct {
	Q      string `json:"q"`
	Cat    string `json:"cat"`
	Sort   string `json:"sort"`
	OnSale bool   `json:"onSale"`
	IL     bool   `json:"il"`
	Diet   string `json:"diet"`
	Offset int    `json:"offset"`
	Limit  int    `json:"limit"`
}

type SearchView struct {
	Total int        `json:"total"`
	Items []ItemView `json:"items"`
	Diets []LabelN   `json:"diets"` // diet filters worth offering (from the model's records)
}

type LabelN struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	N     int    `json:"n"`
}

func (e *Engine) Search(r SearchReq) SearchView {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := SearchView{Items: []ItemView{}, Diets: []LabelN{}}
	if e.ix == nil {
		return out
	}
	act, now := e.active(), time.Now()
	var keep func(*shop.Product) bool
	if r.OnSale || r.IL || r.Diet != "" {
		keep = func(p *shop.Product) bool {
			if r.IL && !p.IL {
				return false
			}
			if r.Diet != "" && (p.AI == nil || !slices.Contains(p.AI.D, r.Diet)) {
				return false
			}
			if r.OnSale {
				if _, ok := e.ix.BestDeal(p, act, e.st.Club, now); !ok {
					return false
				}
			}
			return true
		}
	}
	hits := e.ix.Search(r.Q, shop.SearchOpts{Cat: r.Cat, Sort: r.Sort, Keep: keep, Active: act})
	out.Total = len(hits)
	limit := r.Limit
	if limit <= 0 {
		limit = 40
	}
	for i := r.Offset; i < len(hits) && i < r.Offset+limit; i++ {
		out.Items = append(out.Items, e.itemView(hits[i], act, now))
	}
	if r.Offset == 0 {
		out.Diets = e.dietCounts()
	}
	return out
}

func (e *Engine) dietCounts() []LabelN {
	n := map[string]int{}
	for _, p := range e.ix.Products {
		if p.AI != nil {
			for _, d := range p.AI.D {
				n[d]++
			}
		}
	}
	var out []LabelN
	for _, d := range shop.Diets {
		if n[d] >= 5 && d != "kosher" && d != "dairy" && d != "meat" && d != "parve" {
			out = append(out, LabelN{d, shop.DietLabel[d], n[d]})
		}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].N > out[b].N })
	return out
}

// ProductView is the product sheet.
type ProductView struct {
	Code     string     `json:"code"`
	Name     string     `json:"name"`
	Found    bool       `json:"found"`
	Weighted bool       `json:"weighted"`
	Img      string     `json:"img"`
	Facts    []string   `json:"facts"`
	Lo       string     `json:"lo"`
	Hi       string     `json:"hi"`
	LoWhere  string     `json:"loWhere"`
	GapPct   int        `json:"gapPct"`
	Best     string     `json:"best"` // best deal line
	Rows     []PriceRow `json:"rows"`
	Qty      float64    `json:"qty"`
	Watched  bool       `json:"watched"`
	Listed   []string   `json:"listed"` // branches listing it without a price
	Odd      []string   `json:"odd"`    // prices set aside as errors
}

type PriceRow struct {
	Store  string   `json:"store"`
	Km     float64  `json:"km"`
	On     bool     `json:"on"`
	Price  string   `json:"price"`
	Diff   string   `json:"diff"` // "+0.80"
	Cheap  bool     `json:"cheap"`
	Stale  string   `json:"stale"` // "לא נמכר כאן 40 ימים"
	Chg    string   `json:"chg"`
	Deals  []string `json:"deals"`  // "2 ב־12.00 ₪ · <the chain's wording>"
	Notes  []string `json:"notes"`  // conditional promotions
	DealAt string   `json:"dealAt"` // price per unit under the best deal here
}

var noteLabel = map[string]string{"basket_min": "בקנייה מעל סכום", "gift": "מתנה בקנייה", "multi_group": "משולב"}

func (e *Engine) Product(code string) ProductView {
	e.mu.RLock()
	defer e.mu.RUnlock()
	v := ProductView{Code: code, Facts: []string{}, Rows: []PriceRow{}, Listed: []string{}, Odd: []string{}}
	if e.ix == nil {
		return v
	}
	p := e.ix.ByCode[code]
	if p == nil {
		return v
	}
	act, now := e.active(), time.Now()
	all := make([]int, len(e.ix.Stores))
	for i := range all {
		all[i] = i
	}
	v.Found, v.Name, v.Weighted, v.Qty, v.Watched = true, p.Name, p.Weighted, e.st.Cart[code], slices.Contains(e.st.Watch, code)
	if e.st.Images {
		v.Img = e.imgURL(p)
	}
	switch {
	case p.Weighted && p.Picks != nil:
		v.Facts = append(v.Facts, "מחיר לק״ג · המוצר המקביל בכל רשת")
	case p.Weighted:
		v.Facts = append(v.Facts, "מחיר לק״ג")
	case strings.Contains(p.Code, ":"):
		v.Facts = append(v.Facts, "פריט של הרשת (קוד פנימי)")
	default:
		v.Facts = append(v.Facts, "ברקוד "+p.Code)
	}
	pi := p.PriceInfo(all)
	if z, ok := shop.SizeOf(p); ok && pi.Lo > 0 {
		u, _ := shop.UnitPriceOf(z, true, float64(pi.Lo))
		v.Facts = append(v.Facts, "גודל: "+z.Text()+" · "+u.Text()+" במחיר הזול")
	}
	var facts []string
	if p.Maker != "" {
		facts = append(facts, "יצרן: "+p.Maker)
	}
	if p.IL {
		facts = append(facts, "תוצרת הארץ")
	}
	if len(facts) > 0 {
		v.Facts = append(v.Facts, strings.Join(facts, " · "))
	}
	if r := p.AI; r != nil {
		parts := []string{r.T}
		if r.B != "" {
			b := "מותג: " + r.B
			if r.PL {
				b += " (פרטי)"
			}
			parts = append(parts, b)
		}
		for _, s := range []string{r.L, r.V} {
			if s != "" {
				parts = append(parts, s)
			}
		}
		for _, d := range r.D {
			parts = append(parts, shop.DietLabel[d])
		}
		v.Facts = append(v.Facts, strings.Join(parts, " · ")+" (סיווג AI)")
	}
	if p.RawName != "" {
		v.Facts = append(v.Facts, "השם במחירון: "+p.RawName)
	}
	if pi.Lo >= 0 {
		v.Lo, v.Hi, v.LoWhere = shop.Money(float64(pi.Lo)), shop.Money(float64(pi.Hi)), e.ix.StoreName(pi.At)
		if pi.Hi > pi.Lo {
			v.GapPct = int(math.Round((float64(pi.Hi)/float64(pi.Lo) - 1) * 100))
		}
	}
	if d, ok := e.ix.BestDeal(p, act, e.st.Club, now); ok {
		v.Best = "במבצע עכשיו: " + shop.Money(d.Unit) + " ₪ ליחידה ב" + e.ix.StoreName(d.Store) + " (" + shop.DealText(d.Promo) + ")"
	}
	type row struct {
		PriceRow
		v     int32
		stale bool
	}
	var rows []row
	for i, s := range e.ix.Stores {
		price := p.Prices[i]
		if price < 0 {
			continue
		}
		r := row{PriceRow: PriceRow{Store: e.ix.StoreName(i), Km: e.km(s), On: slices.Contains(act, i), Price: shop.Money(float64(price)), Deals: []string{}, Notes: []string{}}, v: price}
		if d := p.Stale[i]; d >= shop.StaleDays {
			r.Stale, r.stale = "לא נמכר כאן "+strconv.Itoa(d)+" ימים: אולי לא על המדף", true
		}
		if d, ok := p.Chg[i]; ok {
			if d == 0 {
				r.Chg = "המחיר עודכן היום"
			} else {
				r.Chg = "המחיר עודכן לפני " + strconv.Itoa(d) + " ימים"
			}
		}
		bestUnit := math.Inf(1)
		for _, pr := range e.ix.Promos(i, code, now) {
			t := shop.DealText(pr)
			if pr.Club {
				t += " · מועדון"
				if !e.st.Club[e.ix.Chains[i]] {
					t += " (דורש כרטיס)"
				}
			}
			if pr.Desc != "" {
				t += " · " + pr.Desc
			}
			r.Deals = append(r.Deals, t)
			if !pr.Club || e.st.Club[e.ix.Chains[i]] {
				bestUnit = math.Min(bestUnit, shop.DealUnit(pr, float64(price)))
			}
		}
		if bestUnit < float64(price) {
			r.DealAt = shop.Money(bestUnit) + " ₪ במבצע"
		}
		for _, n := range e.ix.Notes(i, code, now) {
			r.Notes = append(r.Notes, noteLabel[n.Why]+": "+n.Desc)
		}
		rows = append(rows, r)
	}
	sort.SliceStable(rows, func(a, b int) bool {
		if rows[a].stale != rows[b].stale {
			return !rows[a].stale
		}
		return rows[a].v < rows[b].v
	})
	for k, r := range rows {
		if pi.Lo >= 0 && r.v > pi.Lo {
			r.Diff = "+" + shop.Money(float64(r.v-pi.Lo))
		}
		r.Cheap = k == 0 && !r.stale
		v.Rows = append(v.Rows, r.PriceRow)
	}
	for _, i := range p.NP {
		v.Listed = append(v.Listed, e.ix.StoreName(i))
	}
	for _, o := range p.Odd {
		v.Odd = append(v.Odd, e.ix.StoreName(o[0])+": "+shop.Money(float64(o[1]))+" ₪, כנראה טעות במחירון")
	}
	return v
}

// CartView is the basket compared across the active branches.
type CartView struct {
	Count       int        `json:"count"`
	Lines       []CartLine `json:"lines"`
	Rows        []CartRow  `json:"rows"`
	Split       string     `json:"split"`
	SplitStores int        `json:"splitStores"`
	Saving      string     `json:"saving"` // cheapest vs dearest complete basket
	Common      int        `json:"common"`
}

type CartLine struct {
	Code     string  `json:"code"`
	Name     string  `json:"name"`
	Qty      float64 `json:"qty"`
	Weighted bool    `json:"weighted"`
	Cost     string  `json:"cost"`
	Where    string  `json:"where"`
	Deal     string  `json:"deal"`
	Img      string  `json:"img"`
}

type CartRow struct {
	StoreID string   `json:"storeId"`
	Lat     float64  `json:"lat"`
	Lon     float64  `json:"lon"`
	Store   string   `json:"store"`
	Km      float64  `json:"km"`
	Total   string   `json:"total"`
	Shelf   string   `json:"shelf"`
	Deals   int      `json:"deals"`
	Missing []string `json:"missing"`
	Doubt   []string `json:"doubt"`
	Best    bool     `json:"best"`
}

func (e *Engine) Cart() CartView {
	e.mu.RLock()
	defer e.mu.RUnlock()
	v := CartView{Count: len(e.st.Cart), Lines: []CartLine{}, Rows: []CartRow{}}
	if e.ix == nil || len(e.st.Cart) == 0 {
		return v
	}
	cmp := e.ix.Compare(e.st.Cart, e.active(), e.st.Club, time.Now())
	for _, l := range cmp.Lines {
		cl := CartLine{Code: l.P.Code, Name: l.P.Name, Qty: l.Q, Weighted: l.P.Weighted, Where: "לא נמכר בסניפים שנבחרו"}
		if l.Store >= 0 {
			cl.Cost, cl.Where = shop.Money(l.Cost), e.ix.StoreName(l.Store)
			if l.Promo != nil {
				cl.Deal = shop.DealText(*l.Promo)
			}
		}
		if e.st.Images {
			cl.Img = e.imgURL(l.P)
		}
		v.Lines = append(v.Lines, cl)
	}
	complete := []int{}
	for k, r := range cmp.Rows {
		s := e.ix.Stores[r.Store]
		row := CartRow{StoreID: s.ID, Store: e.ix.StoreName(r.Store), Km: e.km(s), Total: shop.Money(float64(r.Total)), Shelf: shop.Money(float64(r.Shelf)),
			Deals: r.Deals, Missing: r.Missing, Doubt: r.Doubt, Best: k == 0}
		if s.Lat != nil && s.Lon != nil {
			row.Lat, row.Lon = *s.Lat, *s.Lon
		}
		v.Rows = append(v.Rows, row)
		if len(r.Missing) == 0 {
			complete = append(complete, r.Total)
		}
	}
	if len(complete) >= 2 {
		lo, hi := slices.Min(complete), slices.Max(complete)
		if hi > lo {
			v.Saving = shop.Money(float64(hi - lo))
		}
	}
	v.Split, v.SplitStores, v.Common = shop.Money(float64(cmp.Split)), cmp.SplitStores, cmp.Common
	return v
}

// DealView is a deal card.
type DealView struct {
	Code     string  `json:"code"`
	Name     string  `json:"name"`
	Img      string  `json:"img"`
	Headline string  `json:"headline"` // "חוסכים 3.20 ₪ על 2"
	Pct      int     `json:"pct"`
	Price    string  `json:"price"` // per unit under the deal
	Was      string  `json:"was"`   // the cheapest regular price
	Terms    string  `json:"terms"` // "2 ב־12.00 ₪ · מועדון · עד 3"
	Where    string  `json:"where"`
	End      string  `json:"end"`
	Soon     bool    `json:"soon"`
	Real     bool    `json:"real"`
	Check    string  `json:"check"` // "לבדוק בקופה: ..." or ""
	AIYes    bool    `json:"aiYes"`
	Qty      int     `json:"qty"` // units the deal needs
	InCart   float64 `json:"inCart"`
	Mine     bool    `json:"mine"`
}

func (e *Engine) dealView(d *shop.Deal, now time.Time) DealView {
	v := DealView{Code: d.P.Code, Name: d.P.Name, Pct: int(math.Round(d.RealPct)), Price: shop.Money(d.Unit), Qty: d.Qty, Real: d.Verdict == "real",
		End: d.EndLabel(now), Soon: d.EndingSoon(now), AIYes: d.AI == "yes", InCart: e.st.Cart[d.P.Code], Mine: e.st.Freq[d.P.Code] > 0 || slices.Contains(e.st.Watch, d.P.Code)}
	if e.st.Images {
		v.Img = e.imgURL(d.P)
	}
	switch d.Verdict {
	case "real":
		v.Headline = "חוסכים " + shop.Money(float64(d.RealAgorot)) + " ₪"
		if d.Qty > 1 {
			v.Headline += " על " + strconv.Itoa(d.Qty)
		}
		v.Was = shop.Money(d.Cheapest)
	case "notCheapest":
		v.Headline = "זול יותר בלי מבצע ב" + e.ix.Stores[d.CheapestAt].Chain
		v.Was = shop.Money(d.Shelf)
		v.Pct = int(math.Round(d.SavePct))
	default:
		v.Headline = strconv.Itoa(int(math.Round(d.SavePct))) + "% מתחת למדף"
		v.Was = shop.Money(d.Shelf)
		v.Pct = int(math.Round(d.SavePct))
	}
	terms := []string{shop.DealText(d.Promo)}
	if d.Promo.Club {
		terms = append(terms, "מועדון")
	}
	if d.Promo.Max > 0 {
		terms = append(terms, "עד "+strconv.Itoa(d.Promo.Max))
	}
	v.Terms = strings.Join(terms, " · ")
	v.Where = d.ChainLabel
	if len(d.Stores) > 1 {
		v.Where += " · " + strconv.Itoa(len(d.Stores)) + " סניפים"
	} else if b := e.ix.Stores[d.Rep].Branch; b != "" {
		v.Where += " · " + b
	}
	if d.Confidence == "check" {
		v.Check = "לבדוק בקופה: " + d.Why
		if d.AI == "unclear" {
			v.Check += " · גם ה־AI לא בטוח"
		}
	}
	return v
}

type DealsReq struct {
	Cat      string `json:"cat"`
	Chain    string `json:"chain"`
	OnlyReal bool   `json:"onlyReal"`
	Small    bool   `json:"small"` // include savings under ₪1
	Sort     string `json:"sort"`
	Offset   int    `json:"offset"`
	Limit    int    `json:"limit"`
}

type DealsView struct {
	Total   int        `json:"total"`
	Items   []DealView `json:"items"`
	Best    []DealView `json:"best"`
	StockUp []DealView `json:"stockUp"`
	Mine    []DealView `json:"mine"`
	Checked int        `json:"checked"` // flagged "check at the till"
	Chains  []LabelN   `json:"chains"`
}

func (e *Engine) Deals(r DealsReq) DealsView {
	all := e.dealsNow()
	e.mu.RLock()
	defer e.mu.RUnlock()
	v := DealsView{Items: []DealView{}, Best: []DealView{}, StockUp: []DealView{}, Mine: []DealView{}, Chains: []LabelN{}}
	if e.ix == nil {
		return v
	}
	now := time.Now()
	mine := map[string]bool{}
	for c := range e.st.Freq {
		mine[c] = true
	}
	for c := range e.st.Cart {
		mine[c] = true
	}
	for _, c := range e.st.Watch {
		mine[c] = true
	}
	minSave := 100
	if r.Small {
		minSave = 0
	}
	list := shop.FilterDeals(all, shop.DealFilter{Cat: r.Cat, Chain: r.Chain, OnlyReal: r.OnlyReal, MinSave: minSave, Sort: r.Sort, Mine: mine}, now)
	v.Total = len(list)
	limit := r.Limit
	if limit <= 0 {
		limit = 30
	}
	for i := r.Offset; i < len(list) && i < r.Offset+limit; i++ {
		v.Items = append(v.Items, e.dealView(list[i], now))
	}
	if r.Offset == 0 {
		for _, d := range shop.BestOfWeek(all, 10, 3) {
			v.Best = append(v.Best, e.dealView(d, now))
		}
		for _, d := range shop.StockUp(all, 10) {
			v.StockUp = append(v.StockUp, e.dealView(d, now))
		}
		seen := map[string]bool{}
		for _, d := range shop.FilterDeals(all, shop.DealFilter{MinSave: 0, Sort: "useful", Mine: mine}, now) {
			if mine[d.P.Code] && !seen[d.P.Code] && d.Verdict != "notCheapest" {
				seen[d.P.Code] = true
				v.Mine = append(v.Mine, e.dealView(d, now))
				if len(v.Mine) >= 12 {
					break
				}
			}
		}
		chains := map[string]string{}
		var keys []string
		for _, i := range e.active() {
			k := e.ix.Chains[i]
			if _, ok := chains[k]; !ok {
				label := e.ix.Stores[i].Chain
				if k == "shufersal" {
					label = "שופרסל"
				}
				chains[k] = label
				keys = append(keys, k)
			}
		}
		for _, k := range keys {
			v.Chains = append(v.Chains, LabelN{ID: k, Label: chains[k]})
		}
		for _, d := range all {
			if d.Confidence == "check" && d.Verdict == "real" && d.AI != "no" {
				v.Checked++
			}
		}
	}
	return v
}

// HomeView is the first screen.
type HomeView struct {
	Status    StatusView `json:"status"`
	Best      []DealView `json:"best"`
	Mine      []DealView `json:"mine"`
	Regulars  []ItemView `json:"regulars"`
	Cheapest  []IndexRow `json:"cheapest"` // price index per branch
	CartTotal string     `json:"cartTotal"`
	CartWhere string     `json:"cartWhere"`
}

type IndexRow struct {
	Store string  `json:"store"`
	Pct   int     `json:"pct"` // vs the typical price of the same products; negative = cheaper
	Km    float64 `json:"km"`
}

func (e *Engine) Home() HomeView {
	v := HomeView{Status: e.Status(), Best: []DealView{}, Mine: []DealView{}, Regulars: []ItemView{}, Cheapest: []IndexRow{}}
	if !v.Status.Ready {
		return v
	}
	d := e.Deals(DealsReq{Limit: 1})
	v.Best, v.Mine = d.Best, d.Mine
	e.mu.RLock()
	defer e.mu.RUnlock()
	act, now := e.active(), time.Now()
	// my regulars: the products put in a cart most often
	type fc struct {
		c string
		n int
	}
	var fs []fc
	for c, n := range e.st.Freq {
		fs = append(fs, fc{c, n})
	}
	sort.Slice(fs, func(a, b int) bool { return fs[a].n > fs[b].n })
	for _, f := range fs {
		if p := e.ix.ByCode[f.c]; p != nil {
			if pi := p.PriceInfo(act); pi.Lo >= 0 {
				v.Regulars = append(v.Regulars, e.itemView(shop.Hit{P: p, PI: pi}, act, now))
			}
		}
		if len(v.Regulars) >= 12 {
			break
		}
	}
	v.Cheapest = e.priceIndex(act)
	if len(e.st.Cart) > 0 {
		cmp := e.ix.Compare(e.st.Cart, act, e.st.Club, now)
		if len(cmp.Rows) > 0 {
			v.CartTotal, v.CartWhere = shop.Money(float64(cmp.Rows[0].Total)), e.ix.StoreName(cmp.Rows[0].Store)
		}
	}
	return v
}

// priceIndex: each branch's prices against the median of the same products (geometric mean), on
// products sold in at least 3 active branches (insights.ts priceIndex).
func (e *Engine) priceIndex(act []int) []IndexRow {
	logs := make(map[int][]float64)
	for _, p := range e.ix.Products {
		var vs []float64
		for _, i := range act {
			if p.Prices[i] > 0 && !p.IsStale(i) {
				vs = append(vs, float64(p.Prices[i]))
			}
		}
		if len(vs) < 3 {
			continue
		}
		s := append([]float64(nil), vs...)
		sort.Float64s(s)
		med := s[len(s)/2]
		if len(s)%2 == 0 {
			med = (s[len(s)/2-1] + s[len(s)/2]) / 2
		}
		for _, i := range act {
			if p.Prices[i] > 0 && !p.IsStale(i) {
				logs[i] = append(logs[i], math.Log(float64(p.Prices[i])/med))
			}
		}
	}
	var out []IndexRow
	for _, i := range act {
		l := logs[i]
		if len(l) < 50 {
			continue
		}
		sum := 0.0
		for _, x := range l {
			sum += x
		}
		out = append(out, IndexRow{Store: e.ix.StoreName(i), Pct: int(math.Round((math.Exp(sum/float64(len(l))) - 1) * 100)), Km: e.km(e.ix.Stores[i])})
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].Pct < out[b].Pct })
	return out
}

// AIView is the AI settings and status screen.
type AIView struct {
	On          bool           `json:"on"`
	Preset      string         `json:"preset"`
	BaseURL     string         `json:"baseUrl"`
	Model       string         `json:"model"`
	HasKey      bool           `json:"hasKey"`
	KeyTail     string         `json:"keyTail"`
	EnrichModel string         `json:"enrichModel"`
	EnrichUses  string         `json:"enrichUses"` // the model classification will actually use
	EnrichAuto  bool           `json:"enrichAuto"`
	DailyCap    int            `json:"dailyCap"`
	UsedToday   int            `json:"usedToday"`
	Records     int            `json:"records"`
	Total       int            `json:"total"`
	Verdicts    map[string]int `json:"verdicts"`
	Run         *aiStatus      `json:"run"`
	Presets     []PresetView   `json:"presets"`
}

type PresetView struct {
	ID, Label, BaseURL, Model, KeyURL string
}

func (e *Engine) AI() AIView {
	e.mu.RLock()
	defer e.mu.RUnlock()
	c := e.st.AI
	v := AIView{On: c.On, Preset: c.Preset, BaseURL: c.BaseURL, Model: c.Model, HasKey: c.Key != "", EnrichModel: c.EnrichModel, EnrichUses: c.ForEnrich().Model,
		EnrichAuto: c.EnrichAuto, DailyCap: c.DailyCap, Records: e.store.Len(), Verdicts: e.verdicts.Stats(), Run: e.aiRun}
	if n := len(c.Key); n > 4 {
		v.KeyTail = c.Key[n-4:]
	}
	if e.st.Usage.Day == today() {
		v.UsedToday = e.st.Usage.N
	}
	if e.ix != nil {
		v.Total = len(e.ix.Products)
	}
	for _, id := range []string{"gemini", "openrouter", "groq", "custom"} {
		p := ai.Presets[id]
		v.Presets = append(v.Presets, PresetView{id, p.Label, p.BaseURL, p.Model, p.KeyURL})
	}
	return v
}

// AIConfig returns the full config (for editing; the key included, it is the user's own device).
func (e *Engine) AIConfig() ai.Config { return e.aiConfig() }
