package ai

import (
	"context"
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/shop"
)

// The catalog tools (mobile/src/lib/curate.ts): clean names, and confirm duplicate products.

const nameBatch, linkBatch = 60, 50

func namePrompt(ps []*shop.Product) []Message {
	var u []string
	for i, p := range ps {
		u = append(u, strconv.Itoa(i+1)+". "+p.Name)
	}
	return []Message{{"system", `You tidy Israeli supermarket product names from the chains' price files for display. For each name write a clean Hebrew name:
- separate numbers from words and write the size at the end in full: "200ג'" -> "200 גרם", "1.5ל'" -> "1.5 ליטר", "500מ"ל" -> "500 מ״ל", "6יח" -> "6 יחידות";
- expand abbreviations only when sure: "ש.חלב" -> "שוקולד חלב", "לל"ס" -> "ללא סוכר";
- keep the brand, the variety, the fat percentage and every number exactly; never add facts that are not in the name; drop stray marks and repeated spaces;
- keep Latin brand names as they are; keep kashrut words (מהדרין, בד"ץ).
If a name is already clean or you are unsure, return it unchanged. Record every name with record_names.`}, {"user", strings.Join(u, "\n")}}
}

var nameTool = Tool{Name: "record_names", Description: "Record the clean display name of every product in the list.", Schema: map[string]any{
	"type": "object", "required": []string{"names"},
	"properties": map[string]any{"names": map[string]any{"type": "array", "items": map[string]any{
		"type": "object", "required": []string{"n", "name"},
		"properties": map[string]any{"n": map[string]any{"type": "integer"}, "name": map[string]any{"type": "string"}},
	}}},
}}

var matchTool = Tool{Name: "record_matches", Description: "Record whether each pair of names is the same product.", Schema: map[string]any{
	"type": "object", "required": []string{"pairs"},
	"properties": map[string]any{"pairs": map[string]any{"type": "array", "items": map[string]any{
		"type": "object", "required": []string{"n", "verdict"},
		"properties": map[string]any{"n": map[string]any{"type": "integer"}, "verdict": map[string]any{"type": "string", "enum": []string{"same", "different", "unsure"}}},
	}}},
}}

// byN reads a tool's list of {"n":..., field:...} into n -> value.
func byN(args json.RawMessage, list, field string) map[int]string {
	var m map[string][]map[string]any
	json.Unmarshal(args, &m)
	out := map[int]string{}
	for _, x := range m[list] {
		n, _ := x["n"].(float64)
		if s, ok := x[field].(string); ok {
			out[int(n)] = s
		}
	}
	return out
}

var numsRx = regexp.MustCompile(`\d+(?:\.\d+)?`)

func numList(s string) string {
	n := numsRx.FindAllString(s, -1)
	f := make([]float64, len(n))
	for i, x := range n {
		f[i], _ = strconv.ParseFloat(x, 64)
	}
	sort.Float64s(f)
	b, _ := json.Marshal(f)
	return string(b)
}

// GoodName: the clean name keeps every number, adds none, keeps at least half the length, and changes something.
func GoodName(orig, clean string) bool {
	c, o := strings.TrimSpace(clean), strings.TrimSpace(orig)
	if c == "" || c == o || len([]rune(c)) < len([]rune(o))/2 || len([]rune(c)) > 2*len([]rune(o))+20 {
		return false
	}
	return numList(o) == numList(c)
}

var bracketEcho = regexp.MustCompile(`\s*\[[^\]]*\]\s*$`)

// CleanNames runs the name task over the candidates (at most n requests); answers go into cur.
func CleanNames(ctx context.Context, cl *Client, c Config, ps []*shop.Product, cur *shop.Curation, n int, apply func(func()), onProgress func(done, of, added int)) string {
	total := min(n, (len(ps)+nameBatch-1)/nameBatch)
	batch := func(i int) []*shop.Product { return ps[i*nameBatch : min(len(ps), (i+1)*nameBatch)] }
	added := 0
	return Run(ctx, cl, c, total, nameTool, func(i int) []Message { return namePrompt(batch(i)) }, func(i int, args json.RawMessage) {
		got := byN(args, "names", "name")
		apply(func() {
			for k, p := range batch(i) {
				v, ok := got[k+1]
				if !ok {
					continue
				}
				cur.Asked["names:"+p.Code] = true
				v = strings.Join(strings.Fields(bracketEcho.ReplaceAllString(v, "")), " ")
				if GoodName(p.Name, v) {
					cur.Names[p.Code] = v
					added++
				}
			}
		})
	}, func(done int) { onProgress(done, total, added) }, 2*time.Minute, nil)
}

func linkPrompt(pairs []shop.LinkPair) []Message {
	var u []string
	for i, x := range pairs {
		a, b := x.A.Name, x.B.Name
		if x.A.Maker != "" {
			a += " (" + x.A.Maker + ")"
		}
		if x.B.Maker != "" {
			b += " (" + x.B.Maker + ")"
		}
		u = append(u, strconv.Itoa(i+1)+". A: "+a+"\n   B: "+b)
	}
	return []Message{{"system", `You match Israeli supermarket products across chains. Each pair has two product names from different price files, already known to have the same pack size. Answer "same" only when both names clearly describe the same product: the same brand, the same product, variety, flavour, fat percentage and pack. Answer "different" when anything differs (another brand, another variety or flavour, a different pack such as a jar vs a bag). Answer "unsure" when the names don't say enough, and in particular when only one of the two names shows a brand or manufacturer: an unbranded name is often the chain's own store brand, a different product. Record every pair with record_matches.`}, {"user", strings.Join(u, "\n")}}
}

// FindLinks asks about candidate duplicate pairs; "same" answers become links awaiting approval.
func FindLinks(ctx context.Context, cl *Client, c Config, pairs []shop.LinkPair, cur *shop.Curation, n int, apply func(func()), onProgress func(done, of, added int)) string {
	total := min(n, (len(pairs)+linkBatch-1)/linkBatch)
	batch := func(i int) []shop.LinkPair { return pairs[i*linkBatch : min(len(pairs), (i+1)*linkBatch)] }
	added := 0
	return Run(ctx, cl, c, total, matchTool, func(i int) []Message { return linkPrompt(batch(i)) }, func(i int, args json.RawMessage) {
		got := byN(args, "pairs", "verdict")
		apply(func() {
			for k, x := range batch(i) {
				v, ok := got[k+1]
				if !ok {
					continue
				}
				cur.Asked["links:"+shop.PairKey(x.A.Code, x.B.Code)] = true
				if v == "same" && cur.Links[x.A.Code] == "" {
					cur.Links[x.A.Code] = x.B.Code
					added++
				}
			}
		})
	}, func(done int) { onProgress(done, total, added) }, 2*time.Minute, nil)
}
