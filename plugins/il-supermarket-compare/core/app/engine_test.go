package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
)

func fixture() core.Catalog {
	lat, lon := 32.08, 34.81
	return core.Catalog{
		Version:    core.CatalogVersion,
		Stores:     []core.Store{{ID: "A:1", Chain: "רשת א", Branch: "מרכז", Lat: &lat, Lon: &lon, FileTime: "202611130710"}, {ID: "B:1", Chain: "רשת ב", Branch: "צפון"}},
		Categories: []core.Category{{ID: "dairy", Name: "חלב"}, {ID: "snacks", Name: "חטיפים"}},
		Products: [][]any{
			{"111", "חלב 3% תנובה 1 ליטר", "dairy", 0, []any{700, 650}, nil, "111", nil},
			{"222", "במבה 80 גרם", "snacks", 0, []any{450, 390}, nil, nil, map[string]any{"maker": "אסם"}},
		},
		Promos: [][]core.Promo{{{ID: "p", Codes: []string{"111"}, MinQty: 2, Kind: "bundle", Value: 1200, Desc: "חלב 2 ב־12"}}, {}},
		Images: []string{"https://img.example/{code}.jpg"},
	}
}

func open(t *testing.T, c core.Catalog) *Engine {
	dir := t.TempDir()
	b, _ := json.Marshal(c)
	os.WriteFile(filepath.Join(dir, "catalog.json"), b, 0o644)
	e, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 200 && !e.Status().Ready; i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if !e.Status().Ready {
		t.Fatal("catalog not loaded")
	}
	return e
}

func TestEngineScreens(t *testing.T) {
	e := open(t, fixture())
	st := e.Status()
	if len(st.Stores) != 2 || st.PriceDate != "13.11 07:10" || st.Products != 2 {
		t.Errorf("status %+v", st)
	}
	s := e.Search(SearchReq{Q: "חלב"})
	if s.Total != 1 || s.Items[0].Price != "6.50" || s.Items[0].Where != "רשת ב · צפון" || s.Items[0].Img != "https://img.example/111.jpg" || s.Items[0].Deal == "" {
		t.Errorf("search %+v", s.Items)
	}
	if n := e.SetQty("111", 2); n != 1 {
		t.Errorf("cart count %d", n)
	}
	e.SetQty("222", 1)
	cart := e.Cart()
	// A: 12.00 (2 for 12) + 4.50 = 16.50; B: 13.00 + 3.90 = 16.90
	if cart.Rows[0].Store != "רשת א · מרכז" || cart.Rows[0].Total != "16.50" || cart.Saving != "0.40" || cart.Split != "15.90" {
		t.Errorf("cart %+v", cart)
	}
	p := e.Product("111")
	if !p.Found || p.Lo != "6.50" || len(p.Rows) != 2 || p.Rows[0].Store != "רשת ב · צפון" || p.Rows[1].Deals[0] == "" {
		t.Errorf("product %+v", p)
	}
	d := e.Deals(DealsReq{})
	if d.Total != 1 || d.Items[0].Headline != "חוסכים 1.00 ₪ על 2" || !d.Items[0].Mine {
		t.Errorf("deals %+v", d.Items)
	}
	h := e.Home()
	if len(h.Regulars) != 2 || h.CartTotal != "16.50" {
		t.Errorf("home %+v", h)
	}
	e.ToggleStore("A:1")
	if s := e.Search(SearchReq{Q: "חלב"}); s.Items[0].Deal != "" {
		t.Errorf("store A off: its deal is gone: %+v", s.Items[0])
	}
	// state survives a restart
	e2, _ := Open(e.dir)
	if e2.Status().CartCount != 2 || len(e2.st.Off) != 1 {
		t.Errorf("state not saved")
	}
}

// SALZOL_CATALOG=... go test ./app -run Real -v
func TestEngineReal(t *testing.T) {
	path := os.Getenv("SALZOL_CATALOG")
	if path == "" {
		t.Skip("set SALZOL_CATALOG")
	}
	b, _ := os.ReadFile(path)
	var c core.Catalog
	json.Unmarshal(b, &c)
	t0 := time.Now()
	e := open(t, c)
	t.Logf("open + index: %v", time.Since(t0))
	for _, f := range []func() any{
		func() any { return e.Search(SearchReq{Q: "גבינה צהובה"}).Total },
		func() any { return e.Home().Cheapest },
		func() any { return e.Deals(DealsReq{}).Total },
		func() any { return e.Deals(DealsReq{Sort: "save"}).Total },
	} {
		t0 := time.Now()
		r := f()
		b, _ := json.Marshal(r)
		if len(b) > 300 {
			b = b[:300]
		}
		t.Logf("%v: %s", time.Since(t0), b)
	}
}
