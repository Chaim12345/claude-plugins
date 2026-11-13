package shop

import "testing"

// The same cases as mobile/src/lib/units.test.ts: the Go and TypeScript parsers must agree.
func TestParseSize(t *testing.T) {
	type want struct {
		k  UnitKind
		a  float64
		pk int
	}
	ok := map[string]want{
		"יוגורט דנונה ביו טבעי 1.7% 200 גרם":      {Weight, 200, 1},
		"SIMPLY FRUIT מולר בטעם אפרסק 3% 150 גר":  {Weight, 150, 1},
		"שוקולד מריר100ג פרה עלית":                {Weight, 100, 1},
		"לחם 7 דגנים קל 1.1קג":                    {Weight, 1100, 1},
		`נקניקיות עוף טרי 1 ק"ג`:                  {Weight, 1000, 1},
		"שוופס מוגז ענבים 1.5ליטר":                {Volume, 1500, 1},
		"פרוט&ווג מנגו תפוח 1ל":                   {Volume, 1000, 1},
		"שמן קנולה 1,5 ליטר":                      {Volume, 1500, 1},
		`קוקה קולה בפלסטיק500 מ"ל`:                {Volume, 500, 1},
		"משחת פרודונטקס הגנה 75מל":                {Volume, 75, 1},
		"כיף שמפו לשיער רגיל 700מ":                {Volume, 700, 1},
		"קולה 6 x 330 מל":                         {Volume, 1980, 6},
		"POLPA עגבניות חתוכות דק 400X3 גרם MUTTI": {Weight, 1200, 3},
		"בירה 330 מל x 6":                         {Volume, 1980, 6},
		"האגיס פרידום דריי שלב 5 32 יחידות":       {Count, 32, 1},
		"מאגדת רפאלס פקאן 5יח":                    {Count, 5, 1},
		"סימילאק גולד שלב 2 700 ג":                {Weight, 700, 1},
		"רויון בקרטון 1.5% 500 מל":                {Volume, 500, 1},
		"מלפפונים במלח 7-9 560גרם":                {Weight, 560, 1},
	}
	for name, w := range ok {
		z, got := ParseSize(name, "")
		if !got || z.Kind != w.k || z.Amount != w.a || z.Packs != w.pk {
			t.Errorf("%q = %+v %v, want %+v", name, z, got, w)
		}
	}
	if z, got := ParseSize("קולה 6x330", "drinks"); !got || z.Amount != 1980 || z.Packs != 6 {
		t.Errorf("drink multipack without a unit = %+v %v", z, got)
	}
	for _, name := range []string{"קולה 6x330", "עוגה 1 יח", "אורז בסמטי מלא סוגת", "חלב 3%", "אלפרו מעדן סויה בטעם וניל 125 גר 4 יח",
		"קוקה קולה זירו 6 1.5 ל", "שמפו 250 מל מרכך 400 מל", "מולר פרוטאין משקה חלבון קפה 25 גרם חלבון", "מלפפונים 10 מלפפונים",
		"חטיף 4 גרעינים", "פריסקיז מעדני חתול 1.43 גרם", "ניילון נצמד 30 מ", "שוקולד 48%"} {
		cat := ""
		if name == "קולה 6x330" {
			cat = "snacks"
		}
		if z, got := ParseSize(name, cat); got {
			t.Errorf("%q: want no size, got %+v", name, z)
		}
	}
}

func TestUnitPrice(t *testing.T) {
	z, ok := ParseSize("גבינה 250 גרם", "")
	if u, _ := UnitPriceOf(z, ok, 1000); u.Agorot != 400 || u.Text() != "4.00 ₪ ל־100 גרם" {
		t.Errorf("unit price %+v %q", u, u.Text())
	}
	if (Size{Weight, 1500, 1}).Text() != "1.5 ק״ג" || (Size{Volume, 330, 1}).Text() != "330 מ״ל" {
		t.Errorf("size text")
	}
	p := &Product{Name: "שם בלי גודל", StatedSize: StatedSize{Volume, 1000}, StatedAgree: 3}
	if z, ok := SizeOf(p); !ok || z.Amount != 1000 || z.Kind != Volume {
		t.Errorf("stated size wins when the name has none: %+v", z)
	}
	q := &Product{Name: "מים", AI: &Record{S: &SizeRec{330, "ml", 6}}}
	if z, ok := SizeOf(q); !ok || z.Amount != 1980 || z.Packs != 6 {
		t.Errorf("the model's size as the last resort: %+v", z)
	}
}
