package core

import (
	"bytes"
	"compress/gzip"
	"strings"
	"testing"
	"unicode/utf16"
)

const sampleXML = `<Root><ChainID>1</ChainID><Items>
<Item><ItemCode>007290004131074</ItemCode><ItemName>חלב 3% *מבצע*</ItemName><ItemPrice>7.20</ItemPrice><bIsWeighted>0</bIsWeighted><ManufactureName>תנובה</ManufactureName></Item>
<Item><ItemCode>123</ItemCode><ItemName>מלפפון</ItemName><ItemPrice>6.90</ItemPrice><bIsWeighted>1</bIsWeighted></Item>
<Item><ItemCode>999</ItemCode><ItemName>free</ItemName><ItemPrice>0.00</ItemPrice></Item>
</Items></Root>`

func checkItems(t *testing.T, items []Item) {
	t.Helper()
	if len(items) != 3 {
		t.Fatalf("want 3 items (a zero price is kept, marked NoPrice), got %d: %+v", len(items), items)
	}
	if !items[2].NoPrice || items[2].Price != 0 || items[0].NoPrice {
		t.Errorf("zero price row = %+v", items[2])
	}
	if items[0].Code != "7290004131074" || items[0].Name != "חלב 3%" || items[0].Price != 7.2 || items[0].Maker != "תנובה" {
		t.Errorf("item 0 = %+v", items[0])
	}
	if !items[1].Weighted {
		t.Errorf("item 1 should be weighted")
	}
}

func TestParsePlainBOMGzip(t *testing.T) {
	items, err := ParsePriceFile(strings.NewReader("\xEF\xBB\xBF" + sampleXML))
	if err != nil {
		t.Fatal(err)
	}
	checkItems(t, items)

	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write([]byte(`<?xml version="1.0" encoding="windows-1255"?>` + sampleXML))
	gz.Close()
	items, err = ParsePriceFile(&buf)
	if err != nil {
		t.Fatal(err)
	}
	checkItems(t, items)
}

func TestParseUTF16(t *testing.T) {
	doc := `<?xml version="1.0" encoding="utf-16"?>` + sampleXML
	u := utf16.Encode([]rune(doc))
	b := []byte{0xFF, 0xFE}
	for _, c := range u {
		b = append(b, byte(c), byte(c>>8))
	}
	items, err := ParsePriceFile(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	checkItems(t, items)
}

func TestFreshRulesHebrewBoundaries(t *testing.T) {
	rule := func(id string) FreshRule {
		for _, r := range FreshRules {
			if r.ID == id {
				return r
			}
		}
		t.Fatalf("no rule %s", id)
		return FreshRule{}
	}
	ok := func(r FreshRule, name string) bool {
		return r.inc.MatchString(name) && (r.exc == nil || !r.exc.MatchString(name))
	}
	cases := []struct {
		id, name string
		want     bool
	}{
		{"f-cucumber", "מלפפון", true}, // final nun: the bug the Python version had
		{"f-cucumber", "מלפפונים", true},
		{"f-cucumber", "מלפפון בייבי", false},
		{"f-tomato", "עגבניה", true},
		{"f-tomato", "עגבניות שרי", false},
		{"f-tomato", "עגבנייה", false}, // \b must hold after a Hebrew letter
		{"f-onion", "בצל יבש", true},
		{"f-onion", "בצלצלים", false},
		{"f-lemon", "לימון", true},
		{"f-lemon", "לימונענע", false},
		{"f-chickenbreast", "פילה עוף טרי", true},
		{"f-chickenbreast", "חזה עוף קפוא", false},
		{"f-chickenbreast", `חזה עוף "יש" טרי`, false},
	}
	for _, c := range cases {
		if got := ok(rule(c.id), c.name); got != c.want {
			t.Errorf("%s %q = %v, want %v", c.id, c.name, got, c.want)
		}
	}
}

func TestCategorize(t *testing.T) {
	cases := map[string]string{
		"שוקולד חלב מעולה 180 גרם":      "snacks",
		"יוגורט כבשים 600 גרם":          "dairy",
		"ברינזה כבשים 18%שומן 250":      "dairy",
		"מרכך לשיער רגיל":               "care",
		"מרכך מקסימה בייבי 4 ל":         "cleaning",
		"מרק זך טעם עוף":                "pantry",
		"חזה בקר דק דק 120 גרם":         "meat",
		"במבה במילוי נוגט 60 גרם":       "snacks",
		"סבן אפ 1.5 ליטר":               "drinks",
		"פסטה ברילה פנה רגטה":           "pantry",
		"דוגלי גורים 3 ק\"ג":            "pets",
		"חלב קרטון+פקק 3% תנובה 1 ליטר": "dairy",
	}
	for name, want := range cases {
		if got := Categorize(name); got != want {
			t.Errorf("Categorize(%q) = %s, want %s", name, got, want)
		}
	}
}

func TestNewestAndStoreTag(t *testing.T) {
	f := newest([]FileRef{
		{Name: "PriceFull7290058140886-001-016-20261112-060006.gz"},
		{Name: "PriceFull7290058140886-001-016-20261111-060006.gz"},
		{Name: "PriceFull7290058140886-001-016-20261112-030000.gz"},
	})
	if f.Name != "PriceFull7290058140886-001-016-20261112-060006.gz" {
		t.Errorf("newest = %s", f.Name)
	}
	for name, want := range map[string]string{
		"PriceFull7290785400000-104-202611120630.gz":        "202611120630",
		"PriceFull7290027600007-001-070-20261112-030000":    "202611120300",
		"PriceFull7290873255550-000-088-20261112-004004.gz": "202611120040",
	} {
		if got := fileStamp(name); got != want {
			t.Errorf("fileStamp(%s) = %s, want %s", name, got, want)
		}
	}
	if storeTag("16") != "-016-" || storeTag("731") != "-731-" {
		t.Errorf("storeTag")
	}
}

func TestBuildCatalogOutliersAndFresh(t *testing.T) {
	mk := func(items ...Item) StoreData { return StoreData{Items: items} }
	stores := []StoreData{
		mk(Item{Code: "7290000000001", Name: "קפה", Price: 10}, Item{Code: "7290000000201", Name: "מלפפון", Price: 6.9, Weighted: true}),
		mk(Item{Code: "7290000000001", Name: "קפה נמס עלית", Price: 12}, Item{Code: "55", Name: "מלפפונים", Price: 4.9, Weighted: true}),
		mk(Item{Code: "7290000000001", Name: "קפה", Price: 120}), // a case price, not a unit price
		mk(Item{Code: "7290000000001", Name: "קפה", Price: 11}),
	}
	got := BuildCatalog(stores, 3, []string{"RamiLevi", "x", "x", "x"})
	var coffee, cuke []any
	for _, p := range got {
		switch p[0] {
		case "7290000000001":
			coffee = p
		case "f-cucumber":
			cuke = p
		}
	}
	if coffee == nil || coffee[1] != "קפה נמס עלית" || coffee[4].([]any)[2] != nil || coffee[4].([]any)[3] != 1100 {
		t.Errorf("coffee = %v", coffee)
	}
	if cuke == nil || cuke[4].([]any)[1] != 490 || cuke[6] != "7290000000201" {
		t.Errorf("cucumber = %v", cuke)
	}
}

// A chain's own items (short internal codes, weighed items no fresh rule covers) are kept per chain,
// even in one branch; barcoded goods follow minStores; weighed produce stays with the fresh rules.
func TestBuildCatalogChainOwnItems(t *testing.T) {
	mk := func(chain string, items ...Item) StoreData {
		return StoreData{Store: Store{Chain: chain}, Items: items}
	}
	stores := []StoreData{
		mk("A", Item{Code: "123", Name: "סלט טונה מעדניה", Price: 39.9, Weighted: true}, Item{Code: "7290000000011", Name: "חלב", Price: 6}, Item{Code: "4455", Name: "לחמניה מהמאפיה", Price: 1.5}),
		mk("A", Item{Code: "123", Name: "סלט טונה מעדניה", Price: 41.9, Weighted: true}, Item{Code: "7290000000011", Name: "חלב", Price: 6.2}),
		mk("B", Item{Code: "123", Name: "משהו אחר לגמרי", Price: 10}, Item{Code: "7290000000022", Name: "גבינה", Price: 9}, Item{Code: "2000001", Name: "עגבניה", Price: 6.9, Weighted: true}),
	}
	ps := BuildCatalog(stores, 2, []string{"A", "A", "B"})
	got := map[string][]any{}
	for _, p := range ps {
		got[p[0].(string)] = p
	}
	if p := got["A:123"]; p == nil || p[3].(int) != 1 || p[4].([]any)[0] != 3990 || p[4].([]any)[1] != 4190 || p[4].([]any)[2] != nil {
		t.Errorf("chain A's deli item: %v", p)
	}
	if got["B:123"] == nil || got["A:4455"] == nil {
		t.Errorf("same internal code in two chains must be two products, and a one-branch internal item kept: %v", got)
	}
	if got["7290000000011"] == nil || got["7290000000022"] != nil {
		t.Errorf("barcoded goods follow minStores")
	}
	if got["B:2000001"] == nil {
		t.Errorf("weighed tomatoes stay findable as chain B's product as well as in the fresh rule")
	}
}

// Nothing a price file lists is lost: unpriced rows, rows without a code, and outlier prices are kept.
func TestBuildCatalogKeepsEveryRow(t *testing.T) {
	mk := func(chain string, items ...Item) StoreData {
		return StoreData{Store: Store{Chain: chain}, Items: items}
	}
	stores := []StoreData{
		mk("A", Item{Code: "7290000000033", Name: "יין", NoPrice: true}, Item{Code: "7290000000044", Name: "סבון", Price: 10}, Item{Name: "פריט בלי קוד", Price: 5}),
		mk("B", Item{Code: "7290000000044", Name: "סבון", Price: 9}, Item{Code: "7290000000055", Name: "קפה", NoPrice: true}, Item{Code: "7290000000055", Name: "קפה", Price: 20}),
		mk("C", Item{Code: "7290000000044", Name: "סבון", Price: 1000}), // 100x: a typing error
	}
	got := map[string][]any{}
	for _, p := range BuildCatalog(stores, 1, []string{"A", "B", "C"}) {
		got[p[0].(string)] = p
	}
	wine := got["7290000000033"]
	if wine == nil || wine[7].(*ProductMeta).NP[0] != 0 || wine[4].([]any)[0] != nil {
		t.Errorf("a product listed only without a price is kept, with no price: %v", wine)
	}
	soap := got["7290000000044"]
	if soap == nil || soap[4].([]any)[2] != nil || soap[7].(*ProductMeta).Odd[0] != [2]int{2, 100000} {
		t.Errorf("an outlier price is set aside, not lost: %v", soap)
	}
	if got["A:n:פריט בלי קוד"] == nil {
		t.Errorf("a row without a code is kept under its name")
	}
	if c := got["7290000000055"]; c == nil || c[4].([]any)[1] != 2000 || c[7] != nil {
		t.Errorf("a priced row wins over an unpriced row of the same code in the same branch: %v", c)
	}
}
