package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/shop"
)

func TestErrorsAndJSON(t *testing.T) {
	e := errorOf(401, []byte(`{"error":{"message":"API key not valid. key=AIzaSECRET"}}`), "")
	if e.Kind != "auth" || strings.Contains(e.Msg, "AIzaSECRET") {
		t.Errorf("auth: %+v", e)
	}
	q := errorOf(429, []byte(`[{"error":{"message":"Resource exhausted"}}]`), "7")
	if q.Kind != "quota" || q.RetryAfter != 7*time.Second || !strings.Contains(q.Msg, "Resource exhausted") {
		t.Errorf("quota: %+v", q)
	}
	if m := ParseJSON("```json\n{\"1\":[\"חלב\"]}\n```"); m == nil || string(m["1"]) != `["חלב"]` {
		t.Errorf("fenced: %v", m)
	}
	if ParseJSON("no json") != nil {
		t.Errorf("not json")
	}
	if !ValidURL("https://api.groq.com/openai/v1") || ValidURL("http://example.com") || !ValidURL("http://10.0.2.2:11434/v1") {
		t.Errorf("urls")
	}
	c := DefaultConfig()
	c.On, c.Key = true, "k"
	if !c.Usable() || c.ForEnrich().Model != "gemini-4-hydrogen" {
		t.Errorf("config %+v", c.ForEnrich())
	}
	c.EnrichModel = "gemini-flash-lite-latest"
	if c.ForEnrich().Model != "gemini-flash-lite-latest" {
		t.Errorf("chosen model")
	}
}

func TestReadRecordAndStore(t *testing.T) {
	cats := map[string]bool{"dairy": true, "snacks": true}
	r := ReadRecord(json.RawMessage(`["חלב","dairy","תנובה","","3%",[1000,"ml",1],["dairy","bogus","dairy"],0,0]`), "other", cats)
	if r == nil || r.C != "dairy" || r.B != "תנובה" || r.S.Amount != 1000 || len(r.D) != 1 || r.PL {
		t.Errorf("record %+v", r)
	}
	if ReadRecord(json.RawMessage(`["חלב","nope","","","",[0,"ml",1],[],1,1]`), "snacks", cats).C != "snacks" {
		t.Errorf("unknown category")
	}
	if ReadRecord(json.RawMessage(`["","dairy"]`), "x", cats) != nil {
		t.Errorf("no type")
	}
	dir := t.TempDir()
	st, _ := OpenStore(dir)
	st.Put([]Row{{Code: "1", H: NameHash("חלב"), Rec: r}, {Code: "2", H: NameHash("במבה"), Rec: r}})
	st2, _ := OpenStore(dir)
	if st2.Len() != 2 {
		t.Fatalf("reload: %d", st2.Len())
	}
	d := st2.Delta([]Item{{Code: "1", Name: "חלב"}, {Code: "2", Name: "במבה חדש"}, {Code: "3", Name: "x"}})
	if len(d) != 2 || d[0].Code != "2" || d[1].Code != "3" {
		t.Errorf("delta %+v", d)
	}
	if NameHash("חלב  3%") != NameHash("חלב 3%") {
		t.Errorf("hash ignores spacing")
	}
}

// A stand-in OpenAI-compatible server: one 429 first, then answers by calling the forced tool
// (or, when noTools, rejects tools with a 400 and answers JSON mode instead).
func fakeServer(t *testing.T, calls *int32, noTools bool) *httptest.Server {
	num := regexp.MustCompile(`(?m)^\s*(\d+)\. `)
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(calls, 1) == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(429)
			return
		}
		var body struct {
			Messages   []Message
			Tools      []map[string]any
			ToolChoice map[string]any `json:"tool_choice"`
		}
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		if noTools && len(body.Tools) > 0 {
			w.WriteHeader(400)
			w.Write([]byte(`{"error":{"message":"tools are not supported for this model"}}`))
			return
		}
		tool := ""
		if fn, ok := body.ToolChoice["function"].(map[string]any); ok {
			tool, _ = fn["name"].(string)
		}
		u := body.Messages[len(body.Messages)-1].Content
		if noTools {
			u = body.Messages[len(body.Messages)-2].Content
			if strings.Contains(body.Messages[0].Content, "product database") {
				tool = "record_products"
			} else {
				tool = "record_verdicts"
			}
		}
		var args any
		switch tool {
		case "record_products":
			var ps []any
			for _, m := range num.FindAllStringSubmatch(u, -1) {
				n := m[1]
				ps = append(ps, map[string]any{"n": json.Number(n), "type": "סוג", "category": "dairy", "brand": "מותג", "tags": []string{}, "own_brand": false, "unsure": false})
			}
			args = map[string]any{"products": ps}
		case "record_verdicts":
			var ps []any
			for i := 1; strings.Contains(u, "P"+itoa(i)+" ["); i++ {
				ps = append(ps, map[string]any{"p": i, "yes": []int{1}, "no": []int{2}, "unclear": []int{}})
			}
			args = map[string]any{"promotions": ps}
		}
		a, _ := json.Marshal(args)
		msg := map[string]any{"role": "assistant", "content": ""}
		if noTools {
			msg["content"] = string(a)
		} else {
			msg["tool_calls"] = []any{map[string]any{"id": "c1", "type": "function", "function": map[string]any{"name": tool, "arguments": string(a)}}}
		}
		resp, _ := json.Marshal(map[string]any{"id": "x", "object": "chat.completion", "model": "m", "choices": []any{map[string]any{"index": 0, "finish_reason": "tool_calls", "message": msg}}})
		w.Header().Set("Content-Type", "application/json")
		w.Write(resp)
	}))
}

func itoa(i int) string { return string(rune('0' + i)) }

func TestEnrichAndCheckRuns(t *testing.T) {
	for _, noTools := range []bool{false, true} {
		t.Run(map[bool]string{false: "tool calls", true: "json fallback"}[noTools], func(t *testing.T) { enrichAndCheck(t, noTools) })
	}
}

func enrichAndCheck(t *testing.T, noTools bool) {
	var calls int32
	srv := fakeServer(t, &calls, noTools)
	defer srv.Close()
	c := Config{On: true, Preset: "custom", BaseURL: strings.Replace(srv.URL, "127.0.0.1", "localhost", 1), Model: "m", Key: "k"}
	cl := &Client{HTTP: srv.Client()}
	st, _ := OpenStore(t.TempDir())
	var items []Item
	for i := 0; i < 100; i++ {
		items = append(items, Item{Code: "c" + string(rune('A'+i%26)) + itoa(i%10), Name: "מוצר", Cat: "dairy"})
	}
	cats := []struct{ ID, Name string }{{"dairy", "חלב"}}
	stop := Enrich(context.Background(), cl, c, st, items, cats, 5, nil)
	if stop != "" || st.Len() == 0 {
		t.Fatalf("enrich: %q, %d records", stop, st.Len())
	}
	// deal check: two flagged deals under one promotion
	cat := &core.Catalog{Stores: []core.Store{{ID: "A:1", Chain: "א"}, {ID: "B:1", Chain: "ב"}}, Categories: []core.Category{{ID: "dairy"}},
		Products: [][]any{{"1", "חלב תנובה", "dairy", 0, []any{1000, 1000}, nil, nil, nil}, {"2", "סבון כביסה", "dairy", 0, []any{1000, 1000}, nil, nil, nil}},
		Promos:   [][]core.Promo{{{ID: "p", Codes: []string{"1", "2"}, MinQty: 1, Kind: "price", Value: 800, Desc: "מבצע מגוון חטיפים"}}, {}}}
	ix, _ := shop.FromCatalog(cat, nil)
	deals := ix.BuildDeals([]int{0, 1}, nil, time.Now())
	v := OpenVerdicts(t.TempDir())
	asked, stop := v.Check(context.Background(), cl, c, deals, 10, nil)
	if stop != "" || asked != 2 {
		t.Fatalf("check: asked %d, %q", asked, stop)
	}
	v.Apply(deals, time.Now())
	got := map[string]string{}
	for _, d := range deals {
		got[d.P.Code] = d.AI + "/" + d.Confidence
	}
	if got["1"] != "yes/ok" || got["2"] != "no/check" {
		t.Errorf("applied %v", got)
	}
}
