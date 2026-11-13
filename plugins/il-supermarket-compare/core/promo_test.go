package core

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The fixtures in testdata/ are trimmed real PromoFull files (12 November 2026): Rami Levy and
// Osher Ad (publishedprices), Shufersal, Keshet Teamim and Tiv Taam. Each keeps one promotion of every
// shape that occurs in the full file and at most three items per promotion.
func parseFixture(t *testing.T, name string) *PromoFile {
	t.Helper()
	f, err := os.Open(filepath.Join("testdata", "promo_"+name+".xml"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	pf, err := ParsePromoFile(f)
	if err != nil {
		t.Fatal(err)
	}
	return pf
}

func findPromo(t *testing.T, pf *PromoFile, id string) Promo {
	t.Helper()
	for _, p := range pf.Promos {
		if p.ID == id {
			return p
		}
	}
	t.Fatalf("promo %s not parsed", id)
	return Promo{}
}

func TestPromoRami(t *testing.T) {
	pf := parseFixture(t, "rami")
	if pf.Total != 16 {
		t.Errorf("total = %d", pf.Total)
	}
	// "3ב10.90" over several noodle flavours: a bundle, MinQty 3, 10.90 for the three.
	b := findPromo(t, pf, "0001428532")
	if b.Kind != KindBundle || b.MinQty != 3 || b.Value != 1090 || b.Club || len(b.Codes) != 3 || b.End != "202611162359" {
		t.Errorf("bundle = %+v", b)
	}
	// "ב8.90": a unit price.
	p := findPromo(t, pf, "0001304743")
	if p.Kind != KindPrice || p.MinQty != 1 || p.Value != 890 {
		t.Errorf("price = %+v", p)
	}
	// Credit-card promotion: club only.
	if c := findPromo(t, pf, "0001427659"); !c.Club {
		t.Errorf("club flag lost: %+v", c)
	}
	// Coupons, basket minimum ("מעל 75"), separate reward groups, per-kg items are counted, not modelled.
	for _, why := range []string{SkipCoupon, SkipBasket, SkipMultiGroup, SkipWeighted} {
		if pf.Skipped[why] == 0 {
			t.Errorf("no %s skip: %v", why, pf.Skipped)
		}
	}
	if len(pf.Promos) == 0 || len(pf.Promos) > pf.Total {
		t.Errorf("promos = %d", len(pf.Promos))
	}
	// The basket-minimum and multi-group ones are kept as notes (shown, not priced); coupons are not.
	whys := map[string]int{}
	for _, n := range pf.Notes {
		whys[n.Why]++
		if len(n.Codes) == 0 || n.Desc == "" {
			t.Errorf("empty note %+v", n)
		}
		if strings.Contains(n.Desc, "קופון") {
			t.Errorf("a coupon became a note: %q", n.Desc)
		}
	}
	if whys[SkipBasket] != pf.Skipped[SkipBasket] || whys[SkipMultiGroup] != pf.Skipped[SkipMultiGroup] {
		t.Errorf("notes by reason %v, skipped %v", whys, pf.Skipped)
	}
}

func TestBuildNotes(t *testing.T) {
	products := [][]any{
		{"7290000000011", "milk", "dairy", 0, []any{600, nil}, nil, "x", nil},
		{"f-tomato", "tomato", "produce", 1, []any{500, 500}, []any{"a", "b"}, nil, nil},
	}
	pf := &PromoFile{Notes: []PromoNote{
		{ID: "basket", Codes: []string{"7290000000011", "unknown"}, Desc: "חלב ב־5 מעל 75", Why: SkipBasket, End: "202611302359"},
		{ID: "ended", Codes: []string{"7290000000011"}, Desc: "x", Why: SkipGift, End: "202611010000"},
		{ID: "nothing", Codes: []string{"unknown"}, Desc: "y", Why: SkipMultiGroup},
	}}
	stores := []StoreData{{Store: Store{FileTime: "202611120300"}, Promos: pf}, {Store: Store{FileTime: "202611120300"}, Promos: pf}}
	out := BuildNotes(stores, products)
	if len(out[0]) != 1 || out[0][0].ID != "basket" || len(out[0][0].Codes) != 1 {
		t.Errorf("store 0: %+v", out[0])
	}
	if len(out[1]) != 0 { // milk isn't sold at store 1
		t.Errorf("store 1: %+v", out[1])
	}
}

func TestPromoOsher(t *testing.T) {
	pf := parseFixture(t, "osher")
	b := findPromo(t, pf, "0001114926") // "2 ב 30"
	if b.Kind != KindBundle || b.MinQty != 2 || b.Value != 3000 {
		t.Errorf("bundle = %+v", b)
	}
	if pf.Skipped[SkipWeighted] == 0 {
		t.Errorf("weighted not skipped: %v", pf.Skipped)
	}
}

func TestPromoShufersal(t *testing.T) {
	pf := parseFixture(t, "shufersal")
	// "0 - כלל הלקוחות" is everyone; each item has its own price after the 5% off.
	gold := findPromo(t, pf, "3246581")
	if gold.Kind != KindPrice || gold.Club {
		t.Errorf("gold = %+v", gold)
	}
	if b := findPromo(t, pf, "4662134"); b.Kind != KindBundle || b.MinQty != 2 || b.Value != 2490 {
		t.Errorf("bundle = %+v", b)
	}
	if pf.Skipped[SkipCoupon] == 0 {
		t.Errorf("coupons not skipped: %v", pf.Skipped)
	}
}

func TestPromoKeshet(t *testing.T) {
	// Keshet's layout: fields on the Promotion, PromotionItems/Item, DiscountRate in basis points.
	pf := parseFixture(t, "keshet")
	if b := findPromo(t, pf, "1216"); b.Kind != KindBundle || b.MinQty != 2 || b.Value != 1490 || b.Start != "201205060000" || b.End != "202611282359" {
		t.Errorf("bundle = %+v", b)
	}
	pc := findPromo(t, pf, "1156135")
	if pc.Kind != KindPercent || pc.Value != 20 {
		t.Errorf("percent = %+v", pc)
	}
	if pf.Skipped[SkipGift] == 0 {
		t.Errorf("1+1 not skipped as gift: %v", pf.Skipped)
	}
}

func TestPromoTivTaam(t *testing.T) {
	pf := parseFixture(t, "tivtaam")
	if c := findPromo(t, pf, "251575"); !c.Club || c.Kind != KindBundle || c.Value != 1600 {
		t.Errorf("club bundle = %+v", c)
	}
	if c := findPromo(t, pf, "336223"); c.Club || c.Kind != KindPrice {
		t.Errorf("price = %+v", c)
	}
}

func TestPromoGzipAndUTF16(t *testing.T) {
	raw, err := os.ReadFile("testdata/promo_keshet.xml")
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write(append([]byte("\xEF\xBB\xBF"), raw...))
	gz.Close()
	pf, err := ParsePromoFile(&buf)
	if err != nil || len(pf.Promos) == 0 {
		t.Fatalf("gzip+BOM: %v %v", pf, err)
	}
}

func TestIsEveryoneAndTimestamp(t *testing.T) {
	for in, want := range map[string]bool{
		"0": true, "0 - כלל הלקוחות": true, "": true, "1 - מועדון": false,
		"1 - מועדון לקוחות , 3 - מועדון לקוחות באשראי": false, "1 - x, 0 - כלל": true,
	} {
		if got := isEveryone([]string{in}); got != want {
			t.Errorf("isEveryone(%q) = %v", in, got)
		}
	}
	for _, c := range [][3]string{
		{"2023-06-18T00:00:00.000", "", "202306180000"},
		{"2012-05-06", "00:00:00", "201205060000"},
		{"2026-11-28", "23:59:00", "202611282359"},
		{"2016-01-01T00:00:00.000", "23:58:00.000", "201601012358"},
		{"2026-11-30T23:59:00.000", "", "202611302359"},
		{"", "", ""},
	} {
		if got := timestamp(c[0], c[1]); got != c[2] {
			t.Errorf("timestamp(%q,%q) = %q, want %q", c[0], c[1], got, c[2])
		}
	}
}

func TestPriceAfter(t *testing.T) {
	cases := []struct {
		p    Promo
		unit float64
		q    int
		want float64
	}{
		{Promo{Kind: KindBundle, MinQty: 2, Value: 1000}, 600, 1, 600},  // below the bundle size: shelf price
		{Promo{Kind: KindBundle, MinQty: 2, Value: 1000}, 600, 2, 1000}, // 2 for 10
		{Promo{Kind: KindBundle, MinQty: 2, Value: 1000}, 600, 5, 2600}, // two bundles + one at shelf
		{Promo{Kind: KindPrice, MinQty: 1, Value: 450}, 600, 3, 1350},
		{Promo{Kind: KindPercent, MinQty: 1, Value: 25}, 800, 2, 1200},
		{Promo{Kind: KindPrice, MinQty: 1, Value: 450, Max: 2}, 600, 3, 1500}, // limit of 2 units
		{Promo{Kind: KindBundle, MinQty: 3, Value: 1000, Max: 6}, 500, 10, 2000 + 4*500},
	}
	for i, c := range cases {
		if got := c.p.priceAfter(c.unit, c.q); got != c.want {
			t.Errorf("case %d: %v", i, got)
		}
	}
}

func TestBuildPromos(t *testing.T) {
	products := [][]any{
		{"7290000000011", "milk", "dairy", 0, []any{600, 650}, nil, "x"},
		{"7290000000028", "cottage", "dairy", 0, []any{550, nil}, nil, "x"},
		{"f-tomato", "tomato", "produce", 1, []any{500, 500}, []any{"a", "b"}, nil},
	}
	pf := &PromoFile{Total: 7, Skipped: map[string]int{SkipCoupon: 1}, Promos: []Promo{
		{ID: "ok", Codes: []string{"7290000000011", "7290000000028", "unknown"}, MinQty: 2, Kind: KindBundle, Value: 1000, End: "202611302359"},
		{ID: "ended", Codes: []string{"7290000000011"}, MinQty: 1, Kind: KindPrice, Value: 400, End: "202611110000"},
		{ID: "future", Codes: []string{"7290000000011"}, MinQty: 1, Kind: KindPrice, Value: 400, Start: "202611200000"},
		{ID: "dearer", Codes: []string{"7290000000011"}, MinQty: 1, Kind: KindPrice, Value: 700},
		{ID: "absent", Codes: []string{"nothere"}, MinQty: 1, Kind: KindPrice, Value: 100},
		{ID: "pct", Codes: []string{"7290000000028"}, MinQty: 1, Kind: KindPercent, Value: 20},
	}}
	stores := []StoreData{
		{Store: Store{ID: "a:1", FileTime: "202611120300"}, Promos: pf},
		{Store: Store{ID: "b:2", FileTime: "202611120300"}}, // no promo file
	}
	out, stats := BuildPromos(stores, products)
	if len(out[1]) != 0 || stats[1].Parsed != 0 {
		t.Errorf("store without promos: %v %v", out[1], stats[1])
	}
	var ids []string
	for _, p := range out[0] {
		ids = append(ids, p.ID)
	}
	if strings.Join(ids, ",") != "ok,pct" {
		t.Fatalf("kept %v", ids)
	}
	if got := out[0][0].Codes; len(got) != 2 { // "unknown" is cut
		t.Errorf("codes = %v", got)
	}
	st := stats[0]
	if st.Parsed != 7 || st.Applied != 2 || st.Skipped[SkipCoupon] != 1 || st.Skipped[SkipExpired] != 2 || st.Skipped[SkipImplausible] != 1 || st.Skipped[SkipNotInCatalog] != 1 {
		t.Errorf("stats = %+v", st)
	}
}

// fakePortal serves a PriceFull but no PromoFull.
type fakePortal struct{ price []byte }

func (f fakePortal) Stores(context.Context) ([]StoreRow, error) { return nil, nil }
func (f fakePortal) LatestPriceFull(context.Context, string) (FileRef, error) {
	return FileRef{Name: "PriceFull1-001-005-20261112-030000.gz", URL: "x"}, nil
}
func (f fakePortal) LatestPromoFull(_ context.Context, id string) (FileRef, error) {
	return FileRef{}, ErrNotPublished{"fake", id}
}
func (f fakePortal) Open(context.Context, FileRef) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader(f.price)), nil
}

func TestFetchPromoMissingIsNotFatal(t *testing.T) {
	dir := t.TempDir()
	s := &Syncer{DataDir: dir}
	p := fakePortal{price: []byte("<Root/>")}
	st := StoreRef{Chain: "fake", StoreID: "5"}
	if _, _, err := s.fetch(context.Background(), p, st, dir, "PriceFull", p.LatestPriceFull); err != nil {
		t.Fatal(err)
	}
	_, _, err := s.fetch(context.Background(), p, st, dir, "PromoFull", p.LatestPromoFull)
	if _, ok := err.(ErrNotPublished); !ok {
		t.Errorf("want ErrNotPublished, got %v", err)
	}
	// Pruning one kind keeps the other kind's file.
	os.WriteFile(filepath.Join(dir, "fake_PromoFull1-001-005-20261111-030000.gz"), nil, 0o644)
	os.WriteFile(filepath.Join(dir, "fake_PromoFull1-001-005-20261112-030000.gz"), nil, 0o644)
	pruneOld(dir, "fake_", storeTag("5"), "PromoFull", filepath.Join(dir, "fake_PromoFull1-001-005-20261112-030000.gz"))
	ents, _ := os.ReadDir(dir)
	if len(ents) != 2 {
		t.Errorf("after prune: %v", ents)
	}
}

func TestSecondItemPromo(t *testing.T) {
	for desc, want := range map[string]bool{
		"טופיפי 125גר השני בחצי מחיר": true,
		"גולון טווינס השני בחצי":      true,
		"יוגורט המוצר השני ב-5":       true,
		"שניצל תירס זוגלובק 2ב50":     false,
		"שניצלונים מצופים 2 ב 40":     false,
	} {
		if got := secondItemRx.MatchString(desc); got != want {
			t.Errorf("%q: got %v want %v", desc, got, want)
		}
	}
	// Published "640" is the second item's price; the pair costs shelf + 640 per branch.
	products := [][]any{
		{"1", "tofifi", "snacks", 0, []any{1280, 1400}, nil, "x"},
		{"2", "dear", "snacks", 0, []any{600, 600}, nil, "x"},
	}
	pf := &PromoFile{Total: 1, Promos: []Promo{{ID: "s", Codes: []string{"1", "2"}, MinQty: 2, Kind: KindBundle, Value: 640, second: true}}}
	out, _ := BuildPromos([]StoreData{{Store: Store{ID: "a:1"}, Promos: pf}, {Store: Store{ID: "a:2"}, Promos: pf}}, products)
	if len(out[0]) != 1 || out[0][0].Value != 1920 || out[0][0].Codes[0] != "1" {
		t.Fatalf("store 0: %+v", out[0]) // 1280+640; code 2's "second" costs more than shelf, dropped
	}
	if len(out[1]) != 1 || out[1][0].Value != 2040 {
		t.Fatalf("store 1: %+v", out[1])
	}
	if got := out[0][0].priceAfter(1280, 2); got != 1920 {
		t.Errorf("pair price %v", got)
	}
}
