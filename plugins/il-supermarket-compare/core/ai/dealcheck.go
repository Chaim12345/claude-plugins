package ai

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/shop"
)

// The "check at the till" deals settled by the model (mobile/src/lib/aicheck.ts): it reads each
// flagged promotion's wording and its products and says, per product, covered / not covered / unclear.
// Answers are kept until the promotion ends.

// Verdicts: chain|promoID|code -> answer and when it expires (unix seconds).
type Verdicts struct {
	path string
	mu   sync.RWMutex
	M    map[string]Verdict
}

type Verdict struct {
	A   string `json:"a"` // "yes", "no", "unclear"
	Exp int64  `json:"e"`
}

func OpenVerdicts(dir string) *Verdicts {
	v := &Verdicts{path: filepath.Join(dir, "ai-verdicts.json"), M: map[string]Verdict{}}
	if b, err := os.ReadFile(v.path); err == nil {
		json.Unmarshal(b, &v.M)
	}
	now := time.Now().Unix()
	for k, x := range v.M {
		if x.Exp <= now {
			delete(v.M, k)
		}
	}
	return v
}

func (v *Verdicts) save() {
	b, _ := json.Marshal(v.M)
	os.WriteFile(v.path, b, 0o644)
}

func (v *Verdicts) Clear() { v.mu.Lock(); v.M = map[string]Verdict{}; v.save(); v.mu.Unlock() }

func key(d *shop.Deal) string { return d.Chain + "|" + d.Promo.ID + "|" + d.P.Code }

// Apply marks the deals with the model's answers: covered ones lose the warning (unless the discount
// is implausibly deep), not-covered ones are marked "no" (the screens hide them), unclear keep it.
func (v *Verdicts) Apply(deals []*shop.Deal, now time.Time) {
	v.mu.RLock()
	defer v.mu.RUnlock()
	for _, d := range deals {
		if d.Confidence != "check" {
			continue
		}
		x, ok := v.M[key(d)]
		if !ok || x.Exp <= now.Unix() {
			continue
		}
		d.AI = x.A
		if x.A == "yes" {
			if d.RealPct > 60 {
				d.CheckKind, d.Why = "deep", "המבצע חל על המוצר, אבל ההנחה חריגה במיוחד"
			} else {
				d.Confidence, d.Why, d.CheckKind = "ok", "", ""
			}
		}
	}
}

// Stats: live answers by kind.
func (v *Verdicts) Stats() map[string]int {
	v.mu.RLock()
	defer v.mu.RUnlock()
	out := map[string]int{"yes": 0, "no": 0, "unclear": 0}
	now := time.Now().Unix()
	for _, x := range v.M {
		if x.Exp > now {
			out[x.A]++
		}
	}
	return out
}

type group struct {
	desc, chain string
	end         int64
	keys, names []string
}

const batchChars = 5000

// Pending: the flagged deals a model can settle (wording or spread) with no live answer, grouped per
// promotion and packed into requests of about 5,000 characters.
func (v *Verdicts) pending(deals []*shop.Deal, now time.Time) [][]*group {
	v.mu.RLock()
	defer v.mu.RUnlock()
	by := map[string]*group{}
	var order []string
	for _, d := range deals {
		if d.Confidence != "check" || (d.CheckKind != "words" && d.CheckKind != "spread") {
			continue
		}
		k := key(d)
		if x, ok := v.M[k]; ok && x.Exp > now.Unix() {
			continue
		}
		gk := d.Chain + "|" + d.Promo.ID
		g := by[gk]
		if g == nil {
			end := now.Add(14 * 24 * time.Hour).Unix()
			if d.HasEnd {
				end = d.End.Unix()
			}
			g = &group{desc: d.Promo.Desc, chain: d.ChainLabel, end: end}
			by[gk] = g
			order = append(order, gk)
		}
		if len(g.keys) < 40 && !contains(g.keys, k) {
			name := d.P.Name
			if d.P.Maker != "" {
				name += " (" + d.P.Maker + ")"
			}
			g.keys, g.names = append(g.keys, k), append(g.names, name)
		}
	}
	var out [][]*group
	var cur []*group
	size := 0
	for _, gk := range order {
		g := by[gk]
		n := len(g.desc) + 30
		for _, nm := range g.names {
			n += len(nm) + 8
		}
		if len(cur) > 0 && size+n > batchChars {
			out, cur, size = append(out, cur), nil, 0
		}
		cur, size = append(cur, g), size+n
	}
	if len(cur) > 0 {
		out = append(out, cur)
	}
	return out
}

func contains(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}

const checkSystem = `You check Israeli supermarket promotions. Each promotion has the chain's own Hebrew wording and the products its price file lists under it. The chain chose to list these products under this promotion, so most of them belong to it.
For each product, decide whether the promotion's wording covers it:
- "yes": the wording names this product, its brand, its product line, or a category it fits (for example "חטיפי אסם" covers Bamba and Bissli, which Osem makes; "מגוון יוגורטים" covers a yogurt; "סלטי אחלה" covers Achla hummus and tahini salads, an Achla/Strauss line).
- "no": only when the wording clearly describes something else: a different product type (soap listed under a snack promotion), a different named brand (Pepsi wording, a 7up product), or a pack size far outside the range the wording gives.
- "unclear": generic wording ("מבצע", "הנחה", a store-brand discount such as "מותג שופרסל" when the name doesn't show the brand), or a product line you don't know. Brand lines are often unfamiliar: when the product type fits the wording and the brand might be the one named, answer "unclear" or "yes", never "no".
Hebrew abbreviations are common: גר'/ג = grams, ל' = litre, מ"ל = ml, יח' = units, 2ב30 = two for 30 shekels.
Answer with JSON only, no other text, in exactly this shape:
{"P1":{"yes":[1,2],"no":[3],"unclear":[]},"P2":{...}}
using the promotion labels and product numbers given.`

func checkPrompt(b []*group) []Message {
	var parts []string
	for i, g := range b {
		lines := []string{"P" + strconv.Itoa(i+1) + " [" + g.chain + "] «" + g.desc + "»"}
		for j, n := range g.names {
			lines = append(lines, "  "+strconv.Itoa(j+1)+". "+n)
		}
		parts = append(parts, strings.Join(lines, "\n"))
	}
	return []Message{{"system", checkSystem}, {"user", strings.Join(parts, "\n\n")}}
}

func (v *Verdicts) read(b []*group, ans map[string]json.RawMessage, now time.Time) int {
	v.mu.Lock()
	defer v.mu.Unlock()
	n := 0
	for i, g := range b {
		var a map[string][]any
		json.Unmarshal(ans["P"+strconv.Itoa(i+1)], &a)
		seen := map[int]bool{}
		until := max(now.Add(24*time.Hour).Unix(), g.end)
		for _, kind := range []string{"no", "unclear", "yes"} { // in two lists: "yes" wins, then "unclear"
			for _, x := range a[kind] {
				f, ok := x.(float64)
				j := int(f) - 1
				if !ok || j < 0 || j >= len(g.keys) {
					continue
				}
				seen[j] = true
				v.M[g.keys[j]] = Verdict{kind, until}
				n++
			}
		}
		for j, k := range g.keys { // skipped: unclear for a day, asked again later
			if !seen[j] {
				v.M[k] = Verdict{"unclear", now.Add(24 * time.Hour).Unix()}
			}
		}
	}
	v.save()
	return n
}

// Check asks the model about the flagged deals without a live answer, at most maxRequests requests.
func (v *Verdicts) Check(ctx context.Context, cl *Client, c Config, deals []*shop.Deal, maxRequests int, onProgress func(done, total int)) (asked int, stop string) {
	bs := v.pending(deals, time.Now())
	if len(bs) > maxRequests {
		bs = bs[:maxRequests]
	}
	stop = Run(ctx, cl, c, len(bs), func(i int) []Message { return checkPrompt(bs[i]) }, func(i int, ans map[string]json.RawMessage) {
		asked += v.read(bs[i], ans, time.Now())
	}, func(done int) {
		if onProgress != nil {
			onProgress(done, len(bs))
		}
	}, 4096, 2*time.Minute, nil)
	return asked, stop
}
