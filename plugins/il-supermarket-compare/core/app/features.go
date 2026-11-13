package app

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/shop"
)

// ---------------------------------------------------------------- price changes and the watch list

// Change is one price that moved at one branch between two catalogs.
type Change struct {
	Day   string `json:"day"`
	Code  string `json:"code"`
	Store string `json:"store"` // store id
	From  int32  `json:"from"`
	To    int32  `json:"to"`
}

// Notice is something worth telling the user: a watched product got cheaper.
type Notice struct {
	At    int64  `json:"at"`
	Code  string `json:"code"`
	Title string `json:"title"`
	Body  string `json:"body"`
	Read  bool   `json:"read"`
}

const keepChangesDays = 30

// diff records the prices that moved between the catalog on screen and the new one, and a notice for
// each watched product whose cheapest price at the active branches dropped. Called with e.mu held.
func (e *Engine) diff(old, nw *shop.Index) {
	if old == nil || nw == nil {
		return
	}
	day := time.Now().Format("2006-01-02")
	oldStore := map[string]int{}
	for i, s := range old.Stores {
		oldStore[s.ID] = i
	}
	var add []Change
	for _, p := range nw.Products {
		op := old.ByCode[p.Code]
		if op == nil {
			continue
		}
		for i, s := range nw.Stores {
			j, ok := oldStore[s.ID]
			if !ok || p.Prices[i] < 0 || op.Prices[j] < 0 || p.Prices[i] == op.Prices[j] {
				continue
			}
			add = append(add, Change{day, p.Code, s.ID, op.Prices[j], p.Prices[i]})
		}
	}
	if len(add) == 0 {
		return
	}
	cut := time.Now().AddDate(0, 0, -keepChangesDays).Format("2006-01-02")
	keep := e.st.Changes[:0]
	for _, c := range e.st.Changes {
		if c.Day >= cut {
			keep = append(keep, c)
		}
	}
	e.st.Changes = append(keep, add...)
	if n := len(e.st.Changes); n > 6000 {
		e.st.Changes = e.st.Changes[n-6000:]
	}
	// watched products: the cheapest price at the active branches, before and after
	act := e.active()
	for _, code := range e.st.Watch {
		p, op := nw.ByCode[code], old.ByCode[code]
		if p == nil || op == nil {
			continue
		}
		before, after := lowest(op, old, act, nw), p.PriceInfo(act)
		if before > 0 && after.Lo > 0 && after.Lo < before {
			pct := int(math.Round((1 - float64(after.Lo)/float64(before)) * 100))
			e.st.Notices = append(e.st.Notices, Notice{At: time.Now().Unix(), Code: code, Title: "ירידת מחיר: " + p.Name,
				Body: fmt.Sprintf("%s ₪ במקום %s ₪ (−%d%%) ב%s", shop.Money(float64(after.Lo)), shop.Money(float64(before)), pct, nw.StoreName(after.At))})
		}
	}
	if n := len(e.st.Notices); n > 100 {
		e.st.Notices = e.st.Notices[n-100:]
	}
	e.logf("sync", "%d מחירים זזו", len(add))
}

// lowest: the product's cheapest price in the old catalog at the stores that are active now.
func lowest(op *shop.Product, old *shop.Index, act []int, nw *shop.Index) int32 {
	ids := map[string]bool{}
	for _, i := range act {
		ids[nw.Stores[i].ID] = true
	}
	lo := int32(-1)
	for j, s := range old.Stores {
		if ids[s.ID] && op.Prices[j] > 0 && (lo < 0 || op.Prices[j] < lo) {
			lo = op.Prices[j]
		}
	}
	return lo
}

// TakeNotices returns the notices not shown yet and marks them read (the background job posts them).
func (e *Engine) TakeNotices() []Notice {
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []Notice
	for i := range e.st.Notices {
		if !e.st.Notices[i].Read {
			e.st.Notices[i].Read = true
			out = append(out, e.st.Notices[i])
		}
	}
	if len(out) > 0 {
		e.save()
	}
	return out
}

type MoveView struct {
	Code  string `json:"code"`
	Name  string `json:"name"`
	Store string `json:"store"`
	From  string `json:"from"`
	To    string `json:"to"`
	Pct   int    `json:"pct"`
	Day   string `json:"day"`
	Mine  bool   `json:"mine"`
	Img   string `json:"img"`
}

type ChangesView struct {
	Down    []MoveView `json:"down"`
	Up      []MoveView `json:"up"`
	Total   int        `json:"total"`
	Notices []Notice   `json:"notices"`
}

// Changes: the biggest moves of the last 30 days at the active branches, cheaper and dearer, the
// user's own products first.
func (e *Engine) Changes() ChangesView {
	e.mu.RLock()
	defer e.mu.RUnlock()
	v := ChangesView{Down: []MoveView{}, Up: []MoveView{}, Notices: []Notice{}}
	for i := len(e.st.Notices) - 1; i >= 0 && len(v.Notices) < 20; i-- {
		v.Notices = append(v.Notices, e.st.Notices[i])
	}
	if e.ix == nil {
		return v
	}
	on := map[string]int{}
	for _, i := range e.active() {
		on[e.ix.Stores[i].ID] = i
	}
	latest := map[string]Change{} // per product and store, the newest move
	for _, c := range e.st.Changes {
		if _, ok := on[c.Store]; ok {
			latest[c.Code+"|"+c.Store] = c
		}
	}
	for _, c := range latest {
		p := e.ix.ByCode[c.Code]
		if p == nil || c.From <= 0 {
			continue
		}
		pct := int(math.Round((float64(c.To)/float64(c.From) - 1) * 100))
		if pct == 0 {
			continue
		}
		m := MoveView{Code: c.Code, Name: p.Name, Store: e.ix.StoreName(on[c.Store]), From: shop.Money(float64(c.From)), To: shop.Money(float64(c.To)), Pct: pct, Day: c.Day,
			Mine: e.st.Freq[c.Code] > 0 || slices.Contains(e.st.Watch, c.Code) || e.st.Cart[c.Code] > 0}
		if e.st.Images {
			m.Img = e.imgURL(p)
		}
		v.Total++
		if pct < 0 {
			v.Down = append(v.Down, m)
		} else {
			v.Up = append(v.Up, m)
		}
	}
	order := func(l []MoveView, down bool) {
		sort.SliceStable(l, func(a, b int) bool {
			if l[a].Mine != l[b].Mine {
				return l[a].Mine
			}
			if down {
				return l[a].Pct < l[b].Pct
			}
			return l[a].Pct > l[b].Pct
		})
	}
	order(v.Down, true)
	order(v.Up, false)
	if len(v.Down) > 150 {
		v.Down = v.Down[:150]
	}
	if len(v.Up) > 150 {
		v.Up = v.Up[:150]
	}
	return v
}

// Watched: the watch list with today's prices.
func (e *Engine) Watched() []ItemView {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := []ItemView{}
	if e.ix == nil {
		return out
	}
	act, now := e.active(), time.Now()
	for i := len(e.st.Watch) - 1; i >= 0; i-- {
		if p := e.ix.ByCode[e.st.Watch[i]]; p != nil {
			out = append(out, e.itemView(shop.Hit{P: p, PI: p.PriceInfo(act)}, act, now))
		}
	}
	return out
}

// ---------------------------------------------------------------- saved lists

type List struct {
	ID    string             `json:"id"`
	Name  string             `json:"name"`
	Items map[string]float64 `json:"items"`
	At    int64              `json:"at"`
}

// SaveList saves the cart under a name (a new name when it exists: "הסל שלי (2)").
func (e *Engine) SaveList(name string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	name = strings.TrimSpace(name)
	if name == "" {
		name = "הסל שלי"
	}
	base, n := name, 2
	for slices.ContainsFunc(e.st.Lists, func(l List) bool { return l.Name == name }) {
		name = base + " (" + strconv.Itoa(n) + ")"
		n++
	}
	items := map[string]float64{}
	for k, v := range e.st.Cart {
		items[k] = v
	}
	e.st.Lists = append([]List{{ID: strconv.FormatInt(time.Now().UnixNano(), 36), Name: name, Items: items, At: time.Now().Unix()}}, e.st.Lists...)
	e.save()
}

// LoadList puts a saved list in the cart, replacing it or adding to it.
func (e *Engine) LoadList(id string, merge bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, l := range e.st.Lists {
		if l.ID != id {
			continue
		}
		if !merge {
			e.st.Cart = map[string]float64{}
		}
		for k, v := range l.Items {
			e.st.Cart[k] += v
		}
		e.save()
		return
	}
}

func (e *Engine) DeleteList(id string) {
	e.mu.Lock()
	e.st.Lists = slices.DeleteFunc(e.st.Lists, func(l List) bool { return l.ID == id })
	e.save()
	e.mu.Unlock()
}

type ListView struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Count int      `json:"count"`
	Names []string `json:"names"`
	At    string   `json:"at"`
}

func (e *Engine) Lists() []ListView {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := []ListView{}
	for _, l := range e.st.Lists {
		v := ListView{ID: l.ID, Name: l.Name, Count: len(l.Items), Names: []string{}, At: time.Unix(l.At, 0).Format("2.1.2006")}
		if e.ix != nil {
			for c := range l.Items {
				if p := e.ix.ByCode[c]; p != nil && len(v.Names) < 4 {
					v.Names = append(v.Names, p.Name)
				}
			}
		}
		out = append(out, v)
	}
	return out
}

// ---------------------------------------------------------------- in-store checklist

type ShopItem struct {
	Code    string  `json:"code"`
	Name    string  `json:"name"`
	Qty     float64 `json:"qty"`
	Price   string  `json:"price"`
	Deal    string  `json:"deal"`
	Checked bool    `json:"checked"`
	Stale   bool    `json:"stale"`
	Img     string  `json:"img"`
}

type ShopGroup struct {
	Cat   string     `json:"cat"`
	Items []ShopItem `json:"items"`
}

type ShopView struct {
	Store   string      `json:"store"`
	StoreID string      `json:"storeId"`
	Total   string      `json:"total"`
	Groups  []ShopGroup `json:"groups"`
	Missing []string    `json:"missing"`
	Done    int         `json:"done"`
	Of      int         `json:"of"`
	Lat     float64     `json:"lat"`
	Lon     float64     `json:"lon"`
	Address string      `json:"address"`
	Stores  []LabelN    `json:"stores"` // the other branches to choose from (id, name)
}

// Shop is the checklist for one branch ("" = the cheapest for this cart): the cart grouped by
// department in walking order, each item's price there, and what that branch doesn't sell.
func (e *Engine) Shop(storeID string) ShopView {
	e.mu.RLock()
	defer e.mu.RUnlock()
	v := ShopView{Groups: []ShopGroup{}, Missing: []string{}, Stores: []LabelN{}}
	if e.ix == nil || len(e.st.Cart) == 0 {
		return v
	}
	act, now := e.active(), time.Now()
	cmp := e.ix.Compare(e.st.Cart, act, e.st.Club, now)
	i := -1
	for k, s := range e.ix.Stores {
		if s.ID == storeID && slices.Contains(act, k) {
			i = k
		}
	}
	if i < 0 && len(cmp.Rows) > 0 {
		i = cmp.Rows[0].Store
	}
	if i < 0 {
		return v
	}
	for _, r := range cmp.Rows {
		v.Stores = append(v.Stores, LabelN{ID: e.ix.Stores[r.Store].ID, Label: e.ix.StoreName(r.Store) + " · " + shop.Money(float64(r.Total)) + " ₪"})
		if r.Store == i {
			v.Total = shop.Money(float64(r.Total))
		}
	}
	s := e.ix.Stores[i]
	v.Store, v.StoreID, v.Address = e.ix.StoreName(i), s.ID, s.Address
	if s.Lat != nil && s.Lon != nil {
		v.Lat, v.Lon = *s.Lat, *s.Lon
	}
	byCat := map[string][]ShopItem{}
	for code, q := range e.st.Cart {
		p := e.ix.ByCode[code]
		if p == nil {
			continue
		}
		pr, ok := e.ix.PriceAt(p, i, q, e.st.Club, now)
		if !ok {
			v.Missing = append(v.Missing, p.Name)
			continue
		}
		it := ShopItem{Code: code, Name: p.Name, Qty: q, Price: shop.Money(pr.Cost), Checked: e.st.Checked[code], Stale: p.IsStale(i)}
		if p.Weighted && len(p.Picks) > i && p.Picks[i] != "" {
			it.Name = p.Name + " (" + p.Picks[i] + ")"
		}
		if pr.Promo != nil {
			it.Deal = shop.DealText(*pr.Promo)
		}
		if e.st.Images {
			it.Img = e.imgURL(p)
		}
		byCat[p.Cat] = append(byCat[p.Cat], it)
		v.Of++
		if it.Checked {
			v.Done++
		}
	}
	for _, c := range walkOrder {
		l := byCat[c]
		if len(l) == 0 {
			continue
		}
		sort.Slice(l, func(a, b int) bool { return l[a].Name < l[b].Name })
		v.Groups = append(v.Groups, ShopGroup{Cat: catName(e.ix.Cat, c), Items: l})
		delete(byCat, c)
	}
	for c, l := range byCat {
		v.Groups = append(v.Groups, ShopGroup{Cat: catName(e.ix.Cat, c), Items: l})
	}
	sort.Strings(v.Missing)
	return v
}

// walkOrder: departments in the order a shopper usually meets them.
var walkOrder = []string{"produce", "bakery", "dairy", "meat", "frozen", "pantry", "snacks", "drinks", "cleaning", "care", "pets", "other"}

func catName(c *core.Catalog, id string) string {
	for _, x := range c.Categories {
		if x.ID == id {
			return x.Name
		}
	}
	return id
}

func (e *Engine) SetChecked(code string, on bool) {
	e.mu.Lock()
	if e.st.Checked == nil {
		e.st.Checked = map[string]bool{}
	}
	if on {
		e.st.Checked[code] = true
	} else {
		delete(e.st.Checked, code)
	}
	e.save()
	e.mu.Unlock()
}

// ---------------------------------------------------------------- paste a list, scan, share

type ListMatch struct {
	Line  string   `json:"line"`
	Qty   float64  `json:"qty"`
	Code  string   `json:"code"`
	Name  string   `json:"name"`
	Price string   `json:"price"`
	Alts  []LabelN `json:"alts"` // other candidates (code, name)
}

var qtyRx = regexp.MustCompile(`^\s*(\d+(?:[.,]\d+)?)\s*(?:x|×|יח'?|יחידות)?\s+(.+)$|^(.+?)\s+(?:x|×)\s*(\d+(?:[.,]\d+)?)\s*$`)

// ParseList matches each line of a pasted shopping list ("2 חלב 3%", "במבה x3", "- לחם") to the most
// popular product with every word, with up to three alternatives.
func (e *Engine) ParseList(text string) []ListMatch {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := []ListMatch{}
	if e.ix == nil {
		return out
	}
	act, now := e.active(), time.Now()
	for _, raw := range strings.FieldsFunc(text, func(r rune) bool { return r == '\n' || r == ',' || r == ';' }) {
		line := strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(raw), "-*•·▪◦0123456789.)"))
		if strings.TrimSpace(raw) != "" && line == "" {
			line = strings.TrimSpace(raw)
		}
		if line == "" {
			continue
		}
		q, name := 1.0, line
		if m := qtyRx.FindStringSubmatch(strings.TrimSpace(raw)); m != nil {
			if m[1] != "" {
				q, _ = strconv.ParseFloat(strings.Replace(m[1], ",", ".", 1), 64)
				name = m[2]
			} else {
				q, _ = strconv.ParseFloat(strings.Replace(m[4], ",", ".", 1), 64)
				name = m[3]
			}
		}
		if q <= 0 || q > 50 {
			q = 1
		}
		lm := ListMatch{Line: strings.TrimSpace(name), Qty: q, Alts: []LabelN{}}
		hits := e.ix.Search(name, shop.SearchOpts{Active: act})
		for k, h := range hits {
			if h.PI.Lo < 0 {
				continue
			}
			if lm.Code == "" {
				lm.Code, lm.Name, lm.Price = h.P.Code, h.P.Name, shop.Money(float64(h.PI.Lo))
				_ = now
			} else if len(lm.Alts) < 3 {
				lm.Alts = append(lm.Alts, LabelN{ID: h.P.Code, Label: h.P.Name + " · " + shop.Money(float64(h.PI.Lo)) + " ₪"})
			}
			if k > 20 {
				break
			}
		}
		out = append(out, lm)
	}
	return out
}

// AddMany adds quantities to the cart.
func (e *Engine) AddMany(items map[string]float64) {
	e.mu.Lock()
	for c, q := range items {
		if q > 0 {
			if _, had := e.st.Cart[c]; !had {
				e.st.Freq[c]++
			}
			e.st.Cart[c] += q
		}
	}
	e.save()
	e.mu.Unlock()
}

// Lookup finds a scanned barcode: the product code, or "" when no branch around sells it.
func (e *Engine) Lookup(barcode string) string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.ix == nil {
		return ""
	}
	c := strings.TrimLeft(strings.TrimSpace(barcode), "0")
	if e.ix.ByCode[c] != nil {
		return c
	}
	if e.ix.ByCode[barcode] != nil {
		return barcode
	}
	return ""
}

// CartText is the cart as a message to share: items, and the totals at the three cheapest branches.
func (e *Engine) CartText() string {
	c := e.Cart()
	if c.Count == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("🛒 רשימת קניות (סל זול)\n")
	for _, l := range c.Lines {
		q := strconv.FormatFloat(l.Qty, 'f', -1, 64)
		if l.Weighted {
			q += " ק״ג"
		}
		b.WriteString("• " + l.Name + " × " + q + "\n")
	}
	if len(c.Rows) > 0 {
		b.WriteString("\nהכי זול:\n")
		for k, r := range c.Rows {
			if k == 3 {
				break
			}
			b.WriteString(r.Store + ": " + r.Total + " ₪")
			if len(r.Missing) > 0 {
				b.WriteString(" (חסרים " + strconv.Itoa(len(r.Missing)) + ")")
			}
			b.WriteString("\n")
		}
	}
	return b.String()
}

// ---------------------------------------------------------------- diagnostic log

type LogLine struct {
	T   int64  `json:"t"`
	Tag string `json:"tag"`
	Msg string `json:"msg"`
}

type ring struct {
	mu    sync.Mutex
	lines []LogLine
}

const logMax = 1500

func (r *ring) add(tag, msg string) {
	r.mu.Lock()
	r.lines = append(r.lines, LogLine{time.Now().Unix(), tag, msg})
	if len(r.lines) > logMax {
		r.lines = r.lines[len(r.lines)-logMax:]
	}
	r.mu.Unlock()
}

func (e *Engine) logf(tag, f string, a ...any) { e.log.add(tag, fmt.Sprintf(f, a...)) }

// LogText is the diagnostic log as text to share: device-independent facts only.
func (e *Engine) LogText() string {
	st := e.Status()
	var b strings.Builder
	fmt.Fprintf(&b, "סל זול 2.0 · %s · ready=%v products=%d stores=%d/%d priceDate=%s ai=%v\n", time.Now().Format(time.RFC3339), st.Ready, st.Products,
		countOn(st.Stores), len(st.Stores), st.PriceDate, st.AIOn)
	if st.Place != nil {
		fmt.Fprintf(&b, "place: %s (%.3f, %.3f) r=%.0f km\n", st.Place.Name, st.Place.Lat, st.Place.Lon, st.Place.Radius)
	}
	for _, s := range st.Stores {
		fmt.Fprintf(&b, "  %s %s · %s km=%.1f on=%v\n", s.ID, s.Chain, s.Branch, s.Km, s.On)
	}
	e.log.mu.Lock()
	for _, l := range e.log.lines {
		fmt.Fprintf(&b, "%s [%s] %s\n", time.Unix(l.T, 0).Format("01-02 15:04:05"), l.Tag, l.Msg)
	}
	e.log.mu.Unlock()
	return b.String()
}

func countOn(s []StoreView) int {
	n := 0
	for _, x := range s {
		if x.On {
			n++
		}
	}
	return n
}

// ---------------------------------------------------------------- store discovery

// discover adds the stores of the chains whose portals refuse foreign IPs (Victory, Carrefour, Hazi
// Hinam...) from this phone, when due (weekly); quick and offline when nothing is due.
func (e *Engine) discover(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	geo := core.NewGeocoder(filepath.Join(e.dir, "geocode.json"))
	sum, err := core.RefreshExtra(ctx, e.dir, geo, &http.Client{Timeout: 60 * time.Second}, func(ev core.Event) {
		if ev.Phase == "discover" {
			e.setSyncMsg("מאתר סניפים של רשתות נוספות…")
		}
	}, time.Now())
	geo.Save()
	if err != nil {
		e.logf("discover", "נכשל: %v", err)
		return
	}
	if len(sum.Counts) > 0 || len(sum.Errors) > 0 {
		e.logf("discover", "נוספו %v, שגיאות %v", sum.Counts, sum.Errors)
	}
}

func (e *Engine) setSyncMsg(m string) {
	e.mu.Lock()
	e.syncMsg = m
	e.mu.Unlock()
	e.send(Event{Type: "sync", Msg: m})
}
