package ai

import (
	"bufio"
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

// Schema: records are redone when this changes (a new field, a better prompt).
const Schema = 1

// EnrichBatch: products per request (about 110 output tokens each).
const EnrichBatch = 80

// NameHash identifies the name a record was made from: a renamed product is classified again.
func NameHash(name string) string {
	h := uint32(5381)
	for _, r := range strconv.Itoa(Schema) + "|" + shop.Norm(name) {
		h = (h*33 ^ uint32(r))
	}
	return strconv.FormatUint(uint64(h), 36)
}

// Row is one stored record.
type Row struct {
	Code  string       `json:"code"`
	H     string       `json:"h"`
	Rec   *shop.Record `json:"rec"`
	Model string       `json:"model"`
	At    int64        `json:"at"`
}

// Store keeps the records in an append-only JSON-lines file: each batch is one append, the last line
// for a code wins, and Compact rewrites the file when it has grown with replaced lines.
type Store struct {
	path string
	mu   sync.RWMutex
	rows map[string]Row
	n    int // lines in the file
}

func OpenStore(dir string) (*Store, error) {
	s := &Store{path: filepath.Join(dir, "ai-records.jsonl"), rows: map[string]Row{}}
	f, err := os.Open(s.path)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<16), 1<<20)
	for sc.Scan() {
		var r Row
		if json.Unmarshal(sc.Bytes(), &r) == nil && r.Code != "" && r.Rec != nil {
			s.rows[r.Code] = r
		}
		s.n++
	}
	if s.n > 2*len(s.rows)+1000 {
		s.Compact()
	}
	return s, nil
}

func (s *Store) Put(rows []Row) error {
	if len(rows) == 0 {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.OpenFile(s.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	for _, r := range rows {
		b, _ := json.Marshal(r)
		w.Write(b)
		w.WriteByte('\n')
		s.rows[r.Code] = r
		s.n++
	}
	return w.Flush()
}

func (s *Store) Compact() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tmp := s.path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	w := bufio.NewWriter(f)
	for _, r := range s.rows {
		b, _ := json.Marshal(r)
		w.Write(b)
		w.WriteByte('\n')
	}
	w.Flush()
	f.Close()
	s.n = len(s.rows)
	return os.Rename(tmp, s.path)
}

func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rows, s.n = map[string]Row{}, 0
	err := os.Remove(s.path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (s *Store) Len() int { s.mu.RLock(); defer s.mu.RUnlock(); return len(s.rows) }

// Records: code -> record, for the catalog index.
func (s *Store) Records() map[string]*shop.Record {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]*shop.Record, len(s.rows))
	for c, r := range s.rows {
		out[c] = r.Rec
	}
	return out
}

// Item is a product to classify.
type Item struct{ Code, Name, Maker, Cat string }

// Delta: the products with no record, or one made from another name; most-sold first is the caller's order.
func (s *Store) Delta(items []Item) []Item {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []Item
	for _, it := range items {
		if r, ok := s.rows[it.Code]; !ok || r.H != NameHash(it.Name) {
			out = append(out, it)
		}
	}
	return out
}

// EnrichPrompt is the classification request for one batch (mobile/src/lib/enrich.ts enrichPrompt).
func EnrichPrompt(items []Item, cats []struct{ ID, Name string }) []Message {
	var list []string
	for _, c := range cats {
		list = append(list, c.ID+"="+c.Name)
	}
	sys := `You build a product database for an Israeli supermarket price-comparison app from the names in the chains' price files (often abbreviated, sizes glued to words). For each product return an array:
[type, category, brand, line, variant, size, tags, own_brand, unsure]
- type: the product type in Hebrew, generic and singular, without brand, flavour or size ("חלב", "גבינה לבנה", "חטיף תירס", "נוזל כלים", "שמפו", "פסטה", "חזה עוף").
- category: one id of: ` + strings.Join(list, ", ") + `. Pick where a shopper would look ("other" only for non-grocery goods such as toys, clothing, candles).
- brand: the brand or manufacturer shoppers know ("תנובה", "אסם", "שטראוס", "קוקה קולה"), "" if the name shows none. A chain's own brand counts (שופרסל, רמי לוי, יש, ויקטורי, טיב טעם).
- line: product line or sub-brand ("במבה", "דני", "פיניש"), else "".
- variant: flavour, fat %, strength or style in a few words ("3%", "תות", "ללא לקטוז"), else "".
- size: [amount per pack, "g"|"ml"|"u", packs], e.g. "6X330 מל" -> [330,"ml",6], "1 ק"ג" -> [1000,"g",1]; null when the name has no size.
- tags: only from ` + strings.Join(shop.Diets, ", ") + `. Use a tag only when the name says it (כשר, מהדרין, בד"ץ, ללא גלוטן, אורגני, טבעוני, דיאט...) or it is certain from the type (dairy for cheese or yogurt, meat for chicken or beef). Never add kosher or parve by default. [] when none.
- own_brand: 1 if the brand is a supermarket chain's own label, else 0.
- unsure: 1 only if you are unsure of the type or the brand, else 0.
Answer with JSON only: {"1":[...],"2":[...]} with one entry per product, in the order given.`
	var u []string
	for i, it := range items {
		line := strconv.Itoa(i+1) + ". " + it.Name
		if it.Maker != "" {
			line += " [יצרן: " + it.Maker + "]"
		}
		u = append(u, line)
	}
	return []Message{{"system", sys}, {"user", strings.Join(u, "\n")}}
}

func str(v any, n int) string {
	s, _ := v.(string)
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > n {
		s = string(r[:n])
	}
	return s
}

// ReadRecord validates one answer entry; a malformed one is dropped, an unknown category becomes fallback.
func ReadRecord(raw json.RawMessage, fallback string, cats map[string]bool) *shop.Record {
	var a []any
	if json.Unmarshal(raw, &a) != nil {
		var m map[string]any
		if json.Unmarshal(raw, &m) != nil {
			return nil
		}
		a = []any{m["t"], m["c"], m["b"], m["l"], m["v"], m["s"], m["d"], m["pl"], m["q"]}
	}
	for len(a) < 9 {
		a = append(a, nil)
	}
	r := &shop.Record{T: str(a[0], 40)}
	if r.T == "" {
		return nil
	}
	if c, _ := a[1].(string); cats[c] {
		r.C = c
	} else {
		r.C = fallback
	}
	r.B, r.L, r.V = str(a[2], 40), str(a[3], 40), str(a[4], 60)
	if z, ok := a[5].([]any); ok && len(z) >= 2 {
		amt, _ := z[0].(float64)
		unit, _ := z[1].(string)
		packs := 1.0
		if len(z) > 2 {
			if p, ok := z[2].(float64); ok && p >= 1 && p <= 500 {
				packs = p
			}
		}
		if amt > 0 && amt < 1e6 && (unit == "g" || unit == "ml" || unit == "u") {
			r.S = &shop.SizeRec{Amount: amt, Unit: unit, Packs: int(packs)}
		}
	}
	if d, ok := a[6].([]any); ok {
		seen := map[string]bool{}
		for _, x := range d {
			s, _ := x.(string)
			if !seen[s] && shop.DietLabel[s] != "" {
				seen[s] = true
				r.D = append(r.D, s)
			}
		}
	}
	truth := func(v any) bool { b, _ := v.(bool); f, _ := v.(float64); return b || f == 1 }
	r.PL, r.Q = truth(a[7]), truth(a[8])
	return r
}

// ReadEnrich turns one batch's answer into rows; products the model skipped are asked next run.
func ReadEnrich(items []Item, ans map[string]json.RawMessage, cats map[string]bool, model string, now time.Time) []Row {
	var out []Row
	for i, it := range items {
		raw, ok := ans[strconv.Itoa(i+1)]
		if !ok {
			continue
		}
		if rec := ReadRecord(raw, it.Cat, cats); rec != nil {
			out = append(out, Row{Code: it.Code, H: NameHash(it.Name), Rec: rec, Model: model, At: now.Unix()})
		}
	}
	return out
}

// Enrich classifies items (already the delta, in order) in batches, n requests at most, storing each
// batch as soon as it is answered. onBatch reports progress. Returns the stop error, if any.
func Enrich(ctx context.Context, cl *Client, c Config, st *Store, items []Item, cats []struct{ ID, Name string }, n int, onBatch func(done, total, added int)) string {
	c = c.ForEnrich()
	valid := map[string]bool{}
	for _, x := range cats {
		valid[x.ID] = true
	}
	total := min(n, (len(items)+EnrichBatch-1)/EnrichBatch)
	batch := func(i int) []Item { return items[i*EnrichBatch : min(len(items), (i+1)*EnrichBatch)] }
	added := 0
	return Run(ctx, cl, c, total, func(i int) []Message { return EnrichPrompt(batch(i), cats) }, func(i int, ans map[string]json.RawMessage) {
		rows := ReadEnrich(batch(i), ans, valid, c.Model, time.Now())
		added += len(rows)
		st.Put(rows)
	}, func(done int) {
		if onBatch != nil {
			onBatch(done, total, added)
		}
	}, 32000, 5*time.Minute, nil)
}
