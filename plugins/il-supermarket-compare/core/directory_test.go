package core

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

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
	if got := cityFor(StoreRow{City: "8600", Name: "גבעתיים"}, codes, names); got != "גבעתיים" {
		t.Errorf("a branch named after a city: %q", got)
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

func TestPickHitPrefersTypedCity(t *testing.T) {
	hits := []nominatimHit{
		{Lat: "32.43", Lon: "34.91", Address: map[string]string{"town": "חדרה", "state": "מחוז חיפה"}},
		{Lat: "32.81", Lon: "34.99", Address: map[string]string{"city": "חיפה", "suburb": "הדר הכרמל"}},
	}
	if h := pickHit(hits, "הרצל 10, חיפה"); h == nil || h.Lat != "32.81" {
		t.Errorf("picked %+v, want the Haifa result", h)
	}
	if h := pickHit(hits, "הרצל 10"); h == nil || h.Lat != "32.43" {
		t.Errorf("no city given: want the first result, got %+v", h)
	}
	if h := pickHit(hits[:1], "הרצל 10, נתניה"); h != nil {
		t.Errorf("no result in the typed city: want none, got %+v", h)
	}
	if h := pickHit([]nominatimHit{{Lat: "1", Address: map[string]string{"city": "תל אביב-יפו"}}}, "דיזנגוף 50, תל אביב"); h == nil {
		t.Errorf("תל אביב should match תל אביב-יפו")
	}
}

func TestGeocoderFallsBackAndCaches(t *testing.T) {
	calls := map[string]int{}
	fail := &GeoProvider{Name: "down", MinGap: 0, Search: func(context.Context, *http.Client, string) ([]nominatimHit, error) {
		calls["down"]++
		return nil, errors.New("connection reset")
	}}
	ok := &GeoProvider{Name: "up", MinGap: 0, Search: func(context.Context, *http.Client, string) ([]nominatimHit, error) {
		calls["up"]++
		return []nominatimHit{{Lat: "32.81", Lon: "34.99", Address: map[string]string{"city": "חיפה"}}}, nil
	}}
	g := &Geocoder{cache: map[string]*[2]float64{}, Providers: []*GeoProvider{fail, ok}}
	ll, found, err := g.Lookup(context.Background(), "הרצל 10, חיפה")
	if err != nil || !found || ll[0] != 32.81 {
		t.Fatalf("got %v %v %v", ll, found, err)
	}
	if _, _, err := g.Lookup(context.Background(), "הרצל 10, חיפה"); err != nil || calls["up"] != 1 {
		t.Errorf("second lookup should come from the cache: calls=%v err=%v", calls, err)
	}
	all := &Geocoder{cache: map[string]*[2]float64{}, Providers: []*GeoProvider{fail}}
	if _, _, err := all.Lookup(context.Background(), "x, y"); err == nil {
		t.Errorf("every service down should be an error, not a cached miss")
	}
	if _, cached := all.cache["x, y"]; cached {
		t.Errorf("a failure must not be cached")
	}
}
