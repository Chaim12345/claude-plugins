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
	if len(items) != 2 {
		t.Fatalf("want 2 items (zero price dropped), got %d: %+v", len(items), items)
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
