package core

import "testing"

func TestBanner(t *testing.T) {
	cases := []struct {
		chain, name, want string
	}{
		{"shufersal", "שלי רמת גן- ביאליק", "שופרסל שלי"},
		{"shufersal", "יש חסד בני ברק- השומר", "יש חסד"},
		{"shufersal", "יש בני ברק- ירושלים", "יש חסד"},
		{"shufersal", "יוניברס בני ברק איילון", "שופרסל יוניברס"},
		{"shufersal", "שופרסל אקספרס הרוא\"ה רמת גן", "שופרסל אקספרס"},
		{"shufersal", "גוד מרקט בני ברק", "גוד מרקט"},
		{"RamiLevi", "רמת גן  איילון", "רמי לוי"},
		{"carrefour", "קרפור סיטי דיזנגוף", "קרפור סיטי"},
	}
	for _, c := range cases {
		if got := banner(c.chain, StoreRow{Name: c.name}); got != c.want {
			t.Errorf("banner(%s, %q) = %q, want %q", c.chain, c.name, got, c.want)
		}
	}
}

func TestCityFor(t *testing.T) {
	codes := map[string]string{"8600": "רמת גן", "6300": "גבעתיים"}
	names := []string{"רמת גן", "גבעתיים"}
	if got := cityFor(StoreRow{City: "8600"}, codes, names); got != "רמת גן" {
		t.Errorf("code: %q", got)
	}
	if got := cityFor(StoreRow{City: "0", Name: "קולינריק רמת גן"}, codes, names); got != "רמת גן" {
		t.Errorf("from name: %q", got)
	}
	if got := cityFor(StoreRow{City: "חיפה"}, codes, names); got != "חיפה" {
		t.Errorf("name: %q", got)
	}
}

func TestCleanAddress(t *testing.T) {
	cases := map[[2]string]string{
		{`רח' הרוא"ה 152`, "רמת גן"}:       "הרואה 152",
		{`תרצה 19 ר"ג`, "רמת גן"}:          "תרצה 19",
		{"שד' ירושלים 70 (קומה 1)", "יפו"}: "ירושלים 70",
	}
	for in, want := range cases {
		if got := cleanAddress(in[0], in[1]); got != want {
			t.Errorf("cleanAddress(%q) = %q, want %q", in[0], got, want)
		}
	}
}

func TestNearby(t *testing.T) {
	// Around Ramat Gan centre (32.084, 34.814).
	d := &Directory{Stores: []DirStore{
		{Chain: "RamiLevi", StoreID: "1", Banner: "רמי לוי", Lat: 32.10, Lon: 34.83},                  // ~2.3 km, discount
		{Chain: "RamiLevi", StoreID: "2", Banner: "רמי לוי", Lat: 32.0857, Lon: 34.8103},              // ~0.4 km, discount
		{Chain: "shufersal", StoreID: "3", Banner: "שופרסל שלי", Lat: 32.0716, Lon: 34.8292},          // ~2.0 km
		{Chain: "shufersal", StoreID: "4", Banner: "שופרסל שלי", Lat: 32.0800, Lon: 34.8150},          // ~0.5 km, nearer Sheli
		{Chain: "TivTaam", StoreID: "5", Banner: "טיב טעם", Lat: 31.77, Lon: 35.21},                   // Jerusalem
		{Chain: "osherad", StoreID: "6", Banner: "אושר עד", Lat: 32.0841, Lon: 34.8140, Approx: true}, // city centre only
		{Chain: "Keshet", StoreID: "7", Banner: "קשת טעמים", Lat: 0, Lon: 0},                          // unlocated
	}}
	got := d.Nearby(32.084, 34.814, 4, 0)
	keys := map[string]bool{}
	for _, s := range got {
		keys[s.Key()] = true
	}
	for _, want := range []string{"RamiLevi:1", "RamiLevi:2", "shufersal:4", "osherad:6"} {
		if !keys[want] {
			t.Errorf("missing %s in %v", want, keys)
		}
	}
	for _, not := range []string{"shufersal:3", "TivTaam:5", "Keshet:7"} {
		if keys[not] {
			t.Errorf("%s should not be picked", not)
		}
	}
	if got[0].Key() != "osherad:6" && got[0].Km > got[len(got)-1].Km {
		t.Errorf("not sorted by distance")
	}
	if n := len(d.Nearby(32.084, 34.814, 4, 2)); n != 2 {
		t.Errorf("max not applied: %d", n)
	}
	// An approximate (city-centre) store must be well inside the radius.
	if len(d.Nearby(32.084, 34.814, 1.2, 0)) == 0 {
		t.Errorf("exact stores within 1.2 km should still be found")
	}
	for _, s := range d.Nearby(32.084, 34.814, 1.2, 0) {
		if s.Approx {
			t.Errorf("approximate store kept with a 1.2 km radius")
		}
	}
}

func TestConfigFor(t *testing.T) {
	near := []NearStore{{DirStore: DirStore{Chain: "shufersal", StoreID: "70", Banner: "שופרסל שלי", Name: "שלי רמת גן- מרום נווה", Address: "תרצה 19", City: "רמת גן", Lat: 32.07, Lon: 34.83}, Km: 1.2}}
	c := ConfigFor(near, "הרצל 50", 32.08, 34.81)
	if c.Stores[0].Branch != "רמת גן- מרום נווה" || c.Stores[0].ChainName != "שופרסל שלי" || c.Areas[0].Name != "הרצל 50" || c.MinStores != 2 {
		t.Errorf("config = %+v", c)
	}
}
