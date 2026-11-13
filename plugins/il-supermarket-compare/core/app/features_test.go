package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/shop"
)

func TestChangesAndNotices(t *testing.T) {
	e := open(t, fixture())
	e.ToggleWatch("222")
	// a new catalog: bamba 3.90 -> 3.50 at B, milk 7.00 -> 7.50 at A
	c := fixture()
	c.GeneratedAt = "new"
	c.Products[0][4] = []any{750, 650}
	c.Products[1][4] = []any{450, 350}
	b, _ := json.Marshal(c)
	os.WriteFile(filepath.Join(e.dir, "catalog.json"), b, 0o644)
	e.loadCatalog(true)
	ch := e.Changes()
	if ch.Total != 2 || len(ch.Down) != 1 || ch.Down[0].Code != "222" || ch.Down[0].Pct != -10 || len(ch.Up) != 1 {
		t.Fatalf("changes %+v", ch)
	}
	n := e.TakeNotices()
	if len(n) != 1 || n[0].Code != "222" || !strings.Contains(n[0].Body, "3.50 ₪ במקום 3.90 ₪") {
		t.Errorf("notices %+v", n)
	}
	if len(e.TakeNotices()) != 0 {
		t.Errorf("notices are taken once")
	}
}

func TestListsShopParseLookup(t *testing.T) {
	e := open(t, fixture())
	e.SetQty("111", 2)
	e.SetQty("222", 1)
	e.SaveList("")
	e.SaveList("")
	l := e.Lists()
	if len(l) != 2 || l[0].Name != "הסל שלי (2)" || l[0].Count != 2 {
		t.Errorf("lists %+v", l)
	}
	sv := e.Shop("")
	if sv.Store != "רשת א · מרכז" || sv.Total != "16.50" || sv.Of != 2 || len(sv.Groups) != 2 || sv.Groups[0].Cat != "חלב" {
		t.Errorf("shop %+v", sv)
	}
	e.SetChecked("111", true)
	if e.Shop("").Done != 1 {
		t.Errorf("checked")
	}
	e.ClearCart()
	e.LoadList(l[1].ID, false)
	if e.Status().CartCount != 2 {
		t.Errorf("load list")
	}
	m := e.ParseList("2 חלב\nבמבה x3\n- משהו שאין")
	if len(m) != 3 || m[0].Code != "111" || m[0].Qty != 2 || m[1].Code != "222" || m[1].Qty != 3 || m[2].Code != "" {
		t.Errorf("parse %+v", m)
	}
	if e.Lookup("00111") != "111" || e.Lookup("999") != "" {
		t.Errorf("lookup")
	}
	if txt := e.CartText(); !strings.Contains(txt, "חלב 3% תנובה 1 ליטר × 2") || !strings.Contains(txt, "רשת א · מרכז: 16.50 ₪") {
		t.Errorf("cart text %q", txt)
	}
	if !strings.Contains(e.LogText(), "[app] start") {
		t.Errorf("log")
	}
}

func TestAnalysis(t *testing.T) {
	c := fixture()
	c.Stores = c.Stores[:1]
	c.Promos = c.Promos[:1]
	c.Products = nil
	recs := map[string]*shop.Record{}
	add := func(code string, price int, r shop.Record) {
		c.Products = append(c.Products, []any{code, "x" + code + " 1 ליטר", "dairy", 0, []any{price}, nil, nil, nil})
		r.C = "dairy"
		recs[code] = &r
	}
	for i, p := range []int{600, 700, 500, 650, 800} {
		add("t"+string(rune('a'+i)), p, shop.Record{T: "חלב", B: "תנובה"})
		add("s"+string(rune('a'+i)), p+100, shop.Record{T: "משקה סויה", B: "תנובה"})
	}
	for i, p := range []int{400, 450, 420, 430, 410} {
		add("o"+string(rune('a'+i)), p, shop.Record{T: "חלב", B: "שופרסל", PL: true})
		add("p"+string(rune('a'+i)), p+100, shop.Record{T: "משקה סויה", B: "שופרסל", PL: true})
	}
	e := open(t, c)
	ix, _ := shop.FromCatalog(&c, recs) // the records applied as the engine would after classification
	e.mu.Lock()
	e.ix = ix
	e.mu.Unlock()
	a := e.Analysis()
	if a.Done != 20 || len(a.Types) != 2 || a.Types[0].N != 10 {
		t.Fatalf("analysis %+v", a)
	}
	if len(a.Cheap) != 1 || a.Cheap[0].Brand != "שופרסל" || len(a.Dear) != 1 || a.Dear[0].Brand != "תנובה" {
		t.Errorf("brands %+v %+v", a.Cheap, a.Dear)
	}
	if len(a.Own) != 1 || a.Own[0].Pct < 20 {
		t.Errorf("own %+v", a.Own)
	}
}
