package shop

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
)

func fixture() *core.Catalog {
	return &core.Catalog{
		Stores:     []core.Store{{ID: "A:1", Chain: "רשת א"}, {ID: "A:2", Chain: "רשת א"}, {ID: "B:1", Chain: "רשת ב"}},
		Categories: []core.Category{{ID: "dairy", Name: "חלב"}, {ID: "snacks", Name: "חטיפים"}, {ID: "other", Name: "שונות"}},
		Products: [][]any{
			{"111", "חלב 3% תנובה 1 ליטר", "dairy", 0, []any{700, 700, 650}, nil, "111", nil},
			{"222", "במבה 80 גרם", "snacks", 0, []any{450, nil, 390}, nil, nil, map[string]any{"maker": "אסם"}},
			{"333", "גבינה צהובה דק דק 200 גרם", "dairy", 0, []any{nil, nil, 1990}, nil, nil, map[string]any{"stale": [][2]int{{2, 40}}}},
			{"444", "יין", "other", 0, []any{nil, nil, nil}, nil, nil, map[string]any{"np": []int{1}}},
		},
		Promos: [][]core.Promo{{{ID: "p", Codes: []string{"111"}, MinQty: 2, Kind: "bundle", Value: 1200, Desc: "חלב 2 ב־12"}}, {}, {}},
	}
}

func TestIndexSearch(t *testing.T) {
	ix, err := FromCatalog(fixture(), map[string]*Record{"444": {T: "יין אדום", C: "snacks", B: "ברקן", D: []string{"kosher"}}})
	if err != nil {
		t.Fatal(err)
	}
	all := []int{0, 1, 2}
	codes := func(h []Hit) (out []string) {
		for _, x := range h {
			out = append(out, x.P.Code)
		}
		return
	}
	if got := codes(ix.Search("חלב", SearchOpts{Active: all})); len(got) != 1 || got[0] != "111" {
		t.Errorf("חלב -> %v", got)
	}
	if got := codes(ix.Search("אסם", SearchOpts{Active: all})); len(got) != 1 || got[0] != "222" {
		t.Errorf("the maker is searchable: %v", got)
	}
	if got := codes(ix.Search("ברקן כשר", SearchOpts{Active: all})); len(got) != 1 || got[0] != "444" {
		t.Errorf("the model's brand and diet label are searchable: %v", got)
	}
	if ix.ByCode["444"].Cat != "snacks" {
		t.Errorf("the model's category applies")
	}
	if got := codes(ix.Search("דק דק", SearchOpts{Active: all})); len(got) != 1 {
		t.Errorf("repeated words: %v", got)
	}
	if got := codes(ix.Search("", SearchOpts{Active: []int{0}, Sort: "cheap"})); len(got) != 2 || got[0] != "222" {
		t.Errorf("cheapest first at store 0, unpriced 444 is not listed there: %v", got)
	}
	if got := codes(ix.Search("יין", SearchOpts{Active: []int{1}})); len(got) != 1 {
		t.Errorf("listed without a price at store 1: still found: %v", got)
	}
	if pi := ix.ByCode["333"].PriceInfo(all); pi.Lo != 1990 || pi.At != 2 {
		t.Errorf("only a stale price: used when nothing else: %+v", pi)
	}
	if z, ok := SizeOf(ix.ByCode["111"]); !ok || z.Amount != 1000 {
		t.Errorf("size %+v", z)
	}
}

func TestCompareAndDeals(t *testing.T) {
	ix, _ := FromCatalog(fixture(), nil)
	now := time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC)
	cmp := ix.Compare(map[string]float64{"111": 2, "222": 1}, []int{0, 1, 2}, nil, now)
	// store 0: milk 2 for 12.00 + bamba 4.50 = 16.50; store 2: 13.00 + 3.90 = 16.90; store 1 lacks bamba
	if cmp.Rows[0].Store != 0 || cmp.Rows[0].Total != 1650 || cmp.Rows[0].Deals != 1 || cmp.Rows[1].Store != 2 || len(cmp.Rows[2].Missing) != 1 {
		t.Errorf("rows %+v", cmp.Rows)
	}
	if cmp.Split != 1200+390 || cmp.SplitStores != 2 || cmp.Common != 1 {
		t.Errorf("split %+v", cmp)
	}
	deals := ix.BuildDeals([]int{0, 1, 2}, nil, now)
	if len(deals) != 1 || deals[0].Unit != 600 || deals[0].Verdict != "real" || deals[0].RealAgorot != 100 || deals[0].Confidence != "ok" {
		t.Errorf("deals %+v", deals[0])
	}
	if got := DealText(deals[0].Promo); got != "2 ב־12.00 ₪" {
		t.Errorf("deal text %q", got)
	}
}

// SALZOL_CATALOG=path/to/catalog.json go test ./shop -run Real -v: search timing on a real catalog.
func TestRealCatalog(t *testing.T) {
	path := os.Getenv("SALZOL_CATALOG")
	if path == "" {
		t.Skip("set SALZOL_CATALOG")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var c core.Catalog
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	t0 := time.Now()
	ix, err := FromCatalog(&c, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("index %d products in %v (%d words)", len(ix.Products), time.Since(t0), len(ix.vocab))
	all := make([]int, len(c.Stores))
	for i := range all {
		all[i] = i
	}
	for _, q := range []string{"גבינה", "גבינה צהובה", "חלב 3%", "במבה", "ג", ""} {
		t0 := time.Now()
		n := len(ix.Search(q, SearchOpts{Active: all}))
		t.Logf("%q: %d in %v", q, n, time.Since(t0))
	}
	t0 = time.Now()
	d := ix.BuildDeals(all, nil, time.Now())
	t.Logf("deals: %d in %v", len(d), time.Since(t0))
}
