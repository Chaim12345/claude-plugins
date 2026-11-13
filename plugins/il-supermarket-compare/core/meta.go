package core

import (
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Product metadata: what the price files say beyond a name and a price.
//
// Every chain fills these fields differently (and some fill them with junk: one stamps the same
// "manufacturer" on a thousand items, another dates every price "today"), so nothing here is taken
// from a single chain when chains can be compared: a pack size or a manufacturer counts when at
// least two chains agree on it.

// ProductMeta is the optional 8th element of a catalog product.
type ProductMeta struct {
	// Size is [total amount, "g"|"ml"|"u", number of chains that agree]: 1500 g, 1980 ml (a six-pack), 12 units.
	Size []any `json:"size,omitempty"`
	// Maker is the manufacturer or importer, in its shortest agreed form ("אסם", "תנובה").
	Maker string `json:"maker,omitempty"`
	// IL: made in Israel, by agreement of the chains that say where it is made.
	IL bool `json:"il,omitempty"`
	// Stale lists [store index, days] where the branch has not sold the item for StaleFromDays or more:
	// it is listed and priced, but may well not be on the shelf.
	Stale [][2]int `json:"stale,omitempty"`
	// Chg lists [store index, days] where the branch changed the price within ChangedWithinDays.
	Chg [][2]int `json:"chg,omitempty"`
	// NP lists store indexes that list the product without a price (zero or unreadable in the file).
	NP []int `json:"np,omitempty"`
	// Odd lists [store index, agorot] for a price more than 4x off the product's median: kept here, out
	// of the comparison, since it is almost always a unit or typing error.
	Odd [][2]int `json:"odd,omitempty"`
}

func (m *ProductMeta) empty() bool {
	return m == nil || (m.Size == nil && m.Maker == "" && !m.IL && len(m.Stale) == 0 && len(m.Chg) == 0 && len(m.NP) == 0 && len(m.Odd) == 0)
}

const (
	// StaleFromDays: from here a last sale is reported. The apps warn from about a month.
	StaleFromDays = 14
	// ChangedWithinDays: a price change this recent is reported.
	ChangedWithinDays = 30
)

// StoreSignals says which of a store's dates can be trusted, and what "now" is for that store.
type StoreSignals struct {
	Ref     time.Time // the price file's time, or the newest date inside it
	HasSold bool      // the chain reports last-sale dates
	HasChg  bool      // price-update dates are real, not "everything changed today"
}

// parseStamp reads "2026-11-12T13:58:01.000", "2025-02-02 12:21:56", "2026-11-10" or a file stamp
// "202611121358". The chains write local time; so do their file names.
func parseStamp(s string) time.Time {
	s = strings.TrimSpace(s)
	if len(s) == 12 && !strings.ContainsAny(s, "-: T") {
		t, _ := time.Parse("200601021504", s)
		return t
	}
	if len(s) < 10 {
		return time.Time{}
	}
	s = strings.Replace(s, "T", " ", 1)
	if len(s) >= 19 {
		if t, err := time.Parse("2006-01-02 15:04:05", s[:19]); err == nil {
			return t
		}
	}
	if len(s) >= 16 {
		if t, err := time.Parse("2006-01-02 15:04", s[:16]); err == nil {
			return t
		}
	}
	t, _ := time.Parse("2006-01-02", s[:10])
	return t
}

func daysBetween(ref, t time.Time) int {
	if ref.IsZero() || t.IsZero() || t.After(ref) {
		return 0
	}
	return int(ref.Sub(t).Hours() / 24)
}

// Signals inspects one store's items.
func Signals(sd StoreData) StoreSignals {
	sig := StoreSignals{Ref: parseStamp(sd.Store.FileTime)}
	var newest time.Time
	sold, upd := 0, 0
	stamps := make([]time.Time, 0, len(sd.Items))
	for _, it := range sd.Items {
		if it.Sold != "" {
			if t := parseStamp(it.Sold); !t.IsZero() {
				sold++
				if t.After(newest) {
					newest = t
				}
			}
		}
		if it.Updated != "" {
			if t := parseStamp(it.Updated); !t.IsZero() {
				upd++
				stamps = append(stamps, t)
				if t.After(newest) {
					newest = t
				}
			}
		}
	}
	if sig.Ref.IsZero() || newest.After(sig.Ref) {
		sig.Ref = newest
	}
	n := len(sd.Items)
	sig.HasSold = n > 0 && sold*2 >= n
	if n > 0 && upd*2 >= n {
		// A chain that re-stamps its whole price list every night tells us nothing about changes.
		recent := 0
		for _, t := range stamps {
			if daysBetween(sig.Ref, t) <= 2 {
				recent++
			}
		}
		sig.HasChg = recent*4 < len(stamps)
	}
	return sig
}

// ---- pack size ----

var unitQuotes = strings.NewReplacer(`"`, "", `'`, "", "״", "", "׳", "", ".", "", " ", "")

// unitKind maps a UnitQty word to a base unit and a multiplier: "קילוגרם" -> g x1000.
func unitKind(u string) (string, float64) {
	u = strings.ToLower(unitQuotes.Replace(u))
	switch {
	case strings.HasPrefix(u, "קילו"), u == "קג", u == "kg":
		return "g", 1000
	case strings.HasPrefix(u, "מיליליטר"), u == "מל", u == "ml":
		return "ml", 1
	case strings.HasPrefix(u, "ליטר"), u == "ל", u == "l", u == "lt":
		return "ml", 1000
	case strings.HasPrefix(u, "גרם"), u == "גר", u == "ג", u == "g", u == "gr":
		return "g", 1
	case strings.HasPrefix(u, "יחיד"), u == "יח", u == "unit", u == "units":
		return "u", 1
	}
	return "", 0
}

// itemSize is the pack size one chain states for an item, in g, ml or units. ok is false for no
// size, an unknown unit, "1 unit", or an amount no grocery pack has.
func itemSize(it Item) (kind string, amount float64, ok bool) {
	q, err := strconv.ParseFloat(strings.TrimSpace(it.Qty), 64)
	if err != nil || q <= 0 {
		return "", 0, false
	}
	kind, mult := unitKind(it.UnitQty)
	if kind == "" {
		// "לא ידוע" as the unit, but the per-unit base says grams or millilitres ("100 גרם").
		switch {
		case q < 10:
			return "", 0, false
		case strings.Contains(it.Unit, "גרם"):
			kind, mult = "g", 1
		case strings.Contains(it.Unit, "מיליליטר"), strings.Contains(it.Unit, `מ"ל`):
			kind, mult = "ml", 1
		default:
			return "", 0, false
		}
	}
	amount = math.Round(q*mult*10) / 10
	switch kind {
	case "g":
		ok = amount >= 5 && amount <= 50000
	case "ml":
		ok = amount >= 10 && amount <= 30000
	case "u":
		ok = amount >= 2 && amount <= 1000
	}
	return kind, amount, ok
}

type sizeVotes struct {
	chains map[float64]map[string]string // amount -> chain -> kind
}

func (v *sizeVotes) add(chain string, it Item) {
	kind, amount, ok := itemSize(it)
	if !ok {
		return
	}
	if v.chains == nil {
		v.chains = map[float64]map[string]string{}
	}
	if v.chains[amount] == nil {
		v.chains[amount] = map[string]string{}
	}
	if _, seen := v.chains[amount][chain]; !seen {
		v.chains[amount][chain] = kind
	}
}

// result is the amount most chains state, with its unit by majority (chains disagree on whether a
// yogurt is 150 g or 150 ml; drinks lean to ml on a tie, everything else to g).
func (v *sizeVotes) result(cat string) []any {
	best, bestN := 0.0, 0
	for amount, chains := range v.chains {
		if n := len(chains); n > bestN || (n == bestN && amount > best) {
			best, bestN = amount, n
		}
	}
	if bestN == 0 {
		return nil
	}
	count := map[string]int{}
	for _, k := range v.chains[best] {
		count[k]++
	}
	kind := "g"
	switch {
	case count["u"] > count["g"] && count["u"] > count["ml"]:
		kind = "u"
	case count["ml"] > count["g"], count["ml"] == count["g"] && cat == "drinks":
		kind = "ml"
	}
	if kind != "u" && (count["u"] > 0 && count["g"]+count["ml"] == 0) {
		kind = "u"
	}
	return []any{best, kind, bestN}
}

// ---- manufacturer ----

var (
	makerParens = regexp.MustCompile(`\(.*?\)`)
	makerSuffix = regexp.MustCompile(`(?i)(^|\s)(בעמ|בע מ|ltd|inc|gmbh)\.?(\s|$)`)
	makerPunct  = regexp.MustCompile(`[.,\-_/\\&;]+`)
	makerQuotes = strings.NewReplacer(`"`, "", `'`, "", "״", "", "׳", "", "`", "", "&amp;", " ")
)

// Values that say "we don't know" in the manufacturer field.
var noMaker = map[string]bool{"": true, "לא ידוע": true, "unknown": true, "כללי": true, "ללא": true, "לא מוגדר": true,
	"אחר": true, "שונות": true, "ספק כללי": true, "הפריט בפיקוח": true}

// First words that don't identify anyone on their own ("מחלבות גד", "בית השיטה").
var genericMakerWord = map[string]bool{"מחלבות": true, "מחלבת": true, "בית": true, "החברה": true, "מוצרי": true, "גלידות": true,
	"קבוצת": true, "יקבי": true, "יקב": true, "סלטי": true, "מאפיית": true, "מאפיות": true, "מעדני": true, "פרח": true, "א": true,
	"מ": true, "ש": true, "י": true, "תעשיות": true, "טחנות": true, "שיווק": true, "the": true, "חברת": true, "מפעלי": true, "אחים": true}

func cleanMaker(s string) string {
	s = makerQuotes.Replace(s)
	s = makerParens.ReplaceAllString(s, " ")
	s = makerPunct.ReplaceAllString(s, " ")
	s = makerSuffix.ReplaceAllString(s, " ")
	s = strings.Join(strings.Fields(s), " ")
	if noMaker[strings.ToLower(s)] || len([]rune(s)) < 2 {
		return ""
	}
	return s
}

// makerKey groups "אסם", "אסם השקעות" and "אסם תעשיות מזון" under "אסם".
func makerKey(clean string) string {
	w := strings.Fields(strings.ToLower(clean))
	if len(w) == 0 {
		return ""
	}
	if genericMakerWord[w[0]] && len(w) > 1 {
		return w[0] + " " + w[1]
	}
	return w[0]
}

type makerVotes struct {
	byKey map[string]map[string]string // key -> chain -> the chain's cleaned spelling
}

func (v *makerVotes) add(chain, raw string) {
	c := cleanMaker(raw)
	k := makerKey(c)
	if k == "" {
		return
	}
	if v.byKey == nil {
		v.byKey = map[string]map[string]string{}
	}
	if v.byKey[k] == nil {
		v.byKey[k] = map[string]string{}
	}
	if _, seen := v.byKey[k][chain]; !seen {
		v.byKey[k][chain] = c
	}
}

// result is the shortest spelling of the manufacturer at least two chains agree on.
func (v *makerVotes) result() string {
	bestKey, bestN := "", 1
	for k, chains := range v.byKey {
		if n := len(chains); n > bestN || (n == bestN && bestKey != "" && k < bestKey) {
			bestKey, bestN = k, n
		}
	}
	if bestKey == "" {
		return ""
	}
	out := ""
	for _, s := range v.byKey[bestKey] {
		if out == "" || len([]rune(s)) < len([]rune(out)) || (len([]rune(s)) == len([]rune(out)) && s < out) {
			out = s
		}
	}
	return out
}

// ---- country ----

func isIsrael(s string) (israel, known bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	switch s {
	case "", "לא ידוע", "unknown", "0", "-", "לא מוגדר":
		return false, false
	case "il", "isr", "israel", "ישראל", "il2", "תוצרת הארץ":
		return true, true
	}
	return false, true
}

// metaBuilder gathers one product's metadata across stores.
type metaBuilder struct {
	size        sizeVotes
	maker       makerVotes
	il, notIL   map[string]bool // chains
	stale, chgd [][2]int
}

func (b *metaBuilder) add(store int, chain string, it Item, sig StoreSignals) {
	b.size.add(chain, it)
	b.maker.add(chain, it.Maker)
	if israel, known := isIsrael(it.Country); known {
		if b.il == nil {
			b.il, b.notIL = map[string]bool{}, map[string]bool{}
		}
		if israel {
			b.il[chain] = true
		} else {
			b.notIL[chain] = true
		}
	}
	b.dates(store, it, sig)
}

// dates records the per-branch signals only (used on their own for fresh items).
func (b *metaBuilder) dates(store int, it Item, sig StoreSignals) {
	if sig.HasSold {
		if d := daysBetween(sig.Ref, parseStamp(it.Sold)); d >= StaleFromDays {
			b.stale = append(b.stale, [2]int{store, d})
		}
	}
	if sig.HasChg {
		if t := parseStamp(it.Updated); !t.IsZero() {
			if d := daysBetween(sig.Ref, t); d <= ChangedWithinDays {
				b.chgd = append(b.chgd, [2]int{store, d})
			}
		}
	}
}

func (b *metaBuilder) build(cat string) *ProductMeta {
	m := &ProductMeta{Maker: b.maker.result(), Stale: b.stale, Chg: b.chgd}
	if s := b.size.result(cat); s != nil {
		m.Size = s
	}
	// Made in Israel: at least two chains say so and they outnumber those naming another country
	// (one chain's default value is a country nobody imports from).
	m.IL = len(b.il) >= 2 && len(b.il) > len(b.notIL)
	sort.Slice(m.Stale, func(i, j int) bool { return m.Stale[i][0] < m.Stale[j][0] })
	sort.Slice(m.Chg, func(i, j int) bool { return m.Chg[i][0] < m.Chg[j][0] })
	if m.empty() {
		return nil
	}
	return m
}
