package core

import (
	"reflect"
	"strings"
	"testing"
)

func TestParseStampAndDays(t *testing.T) {
	ref := parseStamp("202611121200")
	for in, want := range map[string]int{
		"2026-11-12T08:00:00.000": 0,
		"2026-11-09T21:47:05":     2,
		"2026-10-13 12:00:00":     30,
		"2026-11-10":              2,
		"":                        0,
		"junk":                    0,
		"2026-12-01T00:00:00":     0, // a date after the file: not negative
	} {
		if got := daysBetween(ref, parseStamp(in)); got != want {
			t.Errorf("%q: %d days, want %d", in, got, want)
		}
	}
}

func TestItemSize(t *testing.T) {
	cases := []struct {
		qty, unitQty, unit string
		kind               string
		amount             float64
		ok                 bool
	}{
		{"200.00", "גרם", "100 גרם", "g", 200, true},
		{"1.5", "ליטר", "", "ml", 1500, true},
		{"1.00", "קילוגרמים", `ק"ג`, "g", 1000, true},
		{"330", "מ''ל", "", "ml", 330, true},
		{"12", "יחידות", "", "u", 12, true},
		{"1.00", "יחידות", "", "u", 1, false},              // "one unit" is not a size
		{"1500.00", "לא ידוע", "100 גרם", "g", 1500, true}, // unit unknown, but the per-unit base says grams
		{"1", "לא ידוע", "100 גרם", "", 0, false},
		{"0", "גרם", "", "", 0, false},
		{"900000", "גרם", "", "g", 900000, false},
		{"5", "מטרים", "", "", 0, false},
	}
	for _, c := range cases {
		kind, amount, ok := itemSize(Item{Qty: c.qty, UnitQty: c.unitQty, Unit: c.unit})
		if ok != c.ok || (ok && (kind != c.kind || amount != c.amount)) {
			t.Errorf("%+v: got %s %v %v", c, kind, amount, ok)
		}
	}
}

func TestSizeVotes(t *testing.T) {
	var v sizeVotes
	v.add("a", Item{Qty: "200", UnitQty: "גרם"})
	v.add("a", Item{Qty: "200", UnitQty: "גרם"}) // a chain's second branch is not a second vote
	v.add("b", Item{Qty: "200", UnitQty: "מיליליטר"})
	v.add("c", Item{Qty: "200", UnitQty: "גרם"})
	v.add("d", Item{Qty: "20", UnitQty: "גרם"}) // one chain reads "20 g protein" as the size
	if got := v.result("dairy"); !reflect.DeepEqual(got, []any{200.0, "g", 3}) {
		t.Errorf("got %v", got)
	}
	var tie sizeVotes
	tie.add("a", Item{Qty: "330", UnitQty: "גרם"})
	tie.add("b", Item{Qty: "330", UnitQty: "מיליליטר"})
	if got := tie.result("drinks"); got[1] != "ml" {
		t.Errorf("drinks tie: %v", got)
	}
	if got := tie.result("dairy"); got[1] != "g" {
		t.Errorf("other tie: %v", got)
	}
	var none sizeVotes
	if none.result("x") != nil {
		t.Error("no votes should give no size")
	}
}

func TestMakerVotes(t *testing.T) {
	for in, want := range map[string]string{
		`שטראוס גרופ בע"מ`:  "שטראוס גרופ",
		"לא ידוע":           "",
		",":                 "",
		"Unknown":           "",
		"אסם-נסטלה (ישראל)": "אסם נסטלה",
		`א. סיימן סחר בע"מ`: "א סיימן סחר",
	} {
		if got := cleanMaker(in); got != want {
			t.Errorf("cleanMaker(%q) = %q, want %q", in, got, want)
		}
	}
	var v makerVotes
	v.add("shufersal", "אסם תעשיות מזון")
	v.add("rami", "אסם")
	v.add("wolt", "קבוצת אסם סחר") // a different first word: its own group
	v.add("fresh", "קריות זול")    // one chain's junk value
	if got := v.result(); got != "אסם" {
		t.Errorf("got %q", got)
	}
	var single makerVotes
	single.add("fresh", "קריות זול")
	if got := single.result(); got != "" {
		t.Errorf("one chain alone must not name a manufacturer, got %q", got)
	}
	var generic makerVotes
	generic.add("a", "מחלבות גד")
	generic.add("b", `מחלבות גד בע"מ`)
	generic.add("c", "מחלבות יטבתה")
	if got := generic.result(); got != "מחלבות גד" {
		t.Errorf("got %q", got)
	}
}

func TestSignals(t *testing.T) {
	file := Store{FileTime: "202611121200"}
	real := StoreData{Store: file, Items: []Item{
		{Updated: "2025-01-01T00:00:00", Sold: "2026-11-11T10:00:00"},
		{Updated: "2026-11-10T00:00:00", Sold: "2026-09-01T10:00:00"},
		{Updated: "2024-05-05T00:00:00", Sold: "2026-11-12T08:00:00"},
		{Updated: "2026-03-03T00:00:00", Sold: "2026-11-01T08:00:00"},
		{Updated: "2025-08-08T00:00:00", Sold: "2026-11-12T08:00:00"},
	}}
	if s := Signals(real); !s.HasSold || !s.HasChg {
		t.Errorf("real dates: %+v", s)
	}
	restamped := StoreData{Store: file, Items: []Item{
		{Updated: "2026-11-12T00:39:00"}, {Updated: "2026-11-12T00:39:00"}, {Updated: "2026-11-11T21:00:00"}, {Updated: "2026-10-01T00:00:00"},
	}}
	if s := Signals(restamped); s.HasSold || s.HasChg {
		t.Errorf("a list re-stamped every night says nothing about changes: %+v", s)
	}
	noFileTime := StoreData{Items: []Item{{Updated: "2026-11-01T00:00:00", Sold: "2026-11-10T00:00:00"}}}
	if s := Signals(noFileTime); s.Ref.IsZero() {
		t.Error("without a file time the newest date in the file is the reference")
	}
}

func TestCatalogMeta(t *testing.T) {
	item := func(code, name string, price float64, qty, unit, maker, country, updated, sold string) Item {
		return Item{Code: code, Name: name, Price: price, Qty: qty, UnitQty: unit, Maker: maker, Country: country, Updated: updated, Sold: sold}
	}
	old := "2025-01-01T00:00:00"
	stores := []StoreData{
		{Store: Store{Chain: "A", FileTime: "202611121200"}, Items: []Item{
			item("7290000000011", "ביסלי גריל 200 גרם", 6.9, "200", "גרם", "אסם", "IL", "2026-11-10T09:00:00", "2026-11-12T09:00:00"),
			item("7290000000028", "קפה 20 גרם חלבון", 9.9, "200", "גרם", "", "", old, "2026-09-01T09:00:00"),
			{Code: "111", Name: "עגבניות", Price: 3.9, Weighted: true, Updated: old, Sold: "2026-08-01T00:00:00"},
			{Code: "112", Name: "עגבניה", Price: 6.9, Weighted: true, Updated: old, Sold: "2026-11-12T00:00:00"},
			// filler so the dates look real (most prices are old)
			item("7290000000097", "x", 1, "", "", "", "", old, "2026-11-12T09:00:00"), item("7290000000098", "y", 1, "", "", "", "", old, "2026-11-12T09:00:00"),
			item("7290000000099", "z", 1, "", "", "", "", old, "2026-11-12T09:00:00"), item("7290000000100", "w", 1, "", "", "", "", old, "2026-11-12T09:00:00"),
		}},
		{Store: Store{Chain: "B", FileTime: "202611121200"}, Items: []Item{
			item("7290000000011", "ביסלי גריל", 7.5, "200", "גרם", "אסם תעשיות מזון", "ישראל", "", ""),
			item("7290000000028", "קפה", 10.9, "200", "מיליליטר", "", "", "", ""),
			{Code: "211", Name: "עגבניות", Price: 5.9, Weighted: true},
		}},
	}
	products := BuildCatalog(stores, 2, []string{"A", "B"})
	byCode := map[string][]any{}
	for _, p := range products {
		if len(p) != 8 {
			t.Fatalf("product tuple has %d elements, want 8: %v", len(p), p)
		}
		byCode[p[0].(string)] = p
	}
	bisli := byCode["7290000000011"][7].(*ProductMeta)
	if !reflect.DeepEqual(bisli.Size, []any{200.0, "g", 2}) || bisli.Maker != "אסם" || !bisli.IL {
		t.Errorf("bisli meta = %+v", bisli)
	}
	if !reflect.DeepEqual(bisli.Chg, [][2]int{{0, 2}}) || bisli.Stale != nil {
		t.Errorf("bisli dates = %+v", bisli)
	}
	coffee := byCode["7290000000028"][7].(*ProductMeta)
	if !reflect.DeepEqual(coffee.Stale, [][2]int{{0, 72}}) {
		t.Errorf("coffee stale = %+v", coffee.Stale)
	}
	// Fresh: the 3.90 tomato last sold in August is passed over for the one selling now.
	tomato := byCode["f-tomato"]
	if got := tomato[4].([]any)[0]; got != 690 {
		t.Errorf("tomato price in A = %v, want 690", got)
	}
	if name := tomato[5].([]any)[0].(string); !strings.Contains(name, "עגבניה") {
		t.Errorf("tomato pick = %q", name)
	}
}

func TestLimitFromText(t *testing.T) {
	for desc, want := range map[string]int{
		"סלטי אחלה 350-500גר ב7.90 מו3":      3,
		"דגני בוקר קוקומן תלמה 12.9 מוג 3":   3,
		"שום יבש יבוא רמי לוי ב2.9 מוגבל ל3": 3,
		"גלידת קרמיסימו 1.33 לי 17.90":       0, // "קרמיסימו 1.33" is not a limit
		"מחית עגבניות בליסימו 2 ב18":         0,
		"תפוזינה 1.5 ליטר ב3.90 מו6 כולל":    6,
	} {
		if got := limitFromText(desc); got != want {
			t.Errorf("%q: %d, want %d", desc, got, want)
		}
	}
}
