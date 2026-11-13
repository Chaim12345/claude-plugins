package osmindex

import (
	"bytes"
	"math"
	"sync"
	"testing"
)

func TestNormStreet(t *testing.T) {
	cases := map[string]string{
		"רח' הרצל":            "הרצל",
		"רחוב הרצל":           "הרצל",
		"שד' רוטשילד":         "רוטשילד",
		"שדרות בן גוריון":     "בן גוריון",
		"דרך חברון":           "חברון",
		"סמטת הדס":            "הדס",
		"ז'בוטינסקי":          "זבוטינסקי",
		"ז׳בוטינסקי":          "זבוטינסקי",
		`ד"ר ויצמן`:           "דר ויצמן",
		"יהושוע  חנקין":       "יהושוע חנקין",
		"ברשבסקי|":            "ברשבסקי",
		"האומן,":              "האומן",
		"בר-כוכבא":            "בר כוכבא",
		"ק. אליעזר":           "קרית אליעזר",
		"קריית שמואל":         "קרית שמואל",
		"הרצל / Herzl Street": "הרצל",
		"דרך":                 "דרך",
	}
	for in, want := range cases {
		if got := NormStreet(in); got != want {
			t.Errorf("NormStreet(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormCity(t *testing.T) {
	want := "תל אביב יפו"
	for _, in := range []string{"תל אביב - יפו", "תל אביב-יפו", "תל-אביב יפו", "תל  אביב – יפו"} {
		if got := NormCity(in); got != want {
			t.Errorf("NormCity(%q) = %q", in, got)
		}
	}
	for in, w := range map[string]string{
		"רמת-גן": "רמת גן", `ר"ג`: "רמת גן", "קריית אונו": "קרית אונו", "ק. אונו": "קרית אונו", "קרית אונו": "קרית אונו",
		`פ"ת`: "פתח תקוה", "עיריית חיפה": "חיפה",
	} {
		if got := NormCity(in); got != w {
			t.Errorf("NormCity(%q) = %q, want %q", in, got, w)
		}
	}
}

func TestSkeleton(t *testing.T) {
	if Skeleton("יהושוע חנקין") != Skeleton("יהושע חנקין") {
		t.Error("vav variants should collide")
	}
	if Skeleton("הרב קוק") != Skeleton("קוק") {
		t.Error("honorifics should be dropped")
	}
	if Skeleton("הרצל") == Skeleton("ויצמן") {
		t.Error("different names collided")
	}
}

func TestParseHouseNumbers(t *testing.T) {
	got := ParseHouseNumbers("12א;14-16")
	want := []HouseNum{{12, "א"}, {14, ""}, {16, ""}}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("got %v want %v", got, want)
		}
	}
	if len(ParseHouseNumbers("בלי מספר")) != 0 {
		t.Error("expected none")
	}
}

func TestParseAddress(t *testing.T) {
	cases := []struct {
		addr, city string
		street     string
		num        int
		suf        string
	}{
		{"האומן,15", "עפולה", "האומן", 15, ""},
		{"יהושוע  חנקין 14", "תל אביב - יפו", "יהושוע חנקין", 14, ""},
		{"ברשבסקי 33|", "חיפה", "ברשבסקי", 33, ""},
		{"רח' הרצל 5 תל אביב", "תל אביב - יפו", "הרצל", 5, ""},
		{`שד' בן גוריון 12ב`, "חיפה", "בן גוריון", 12, "ב"},
		{`תרצה 19 ר"ג`, "רמת גן", "תרצה", 19, ""},
		{"אבן גבירול157", "תל אביב - יפו", "אבן גבירול", 157, ""},
		{"חורב 15 | www.kulinarik.co.il/|", "קרית אונו", "חורב", 15, ""},
		{"מרכז מסחרי הרצל 5 (קומה 2)", "נתניה", "מרכז מסחרי הרצל", 5, ""},
		{"15 הרצל", "נתניה", "הרצל", 15, ""},
	}
	for _, c := range cases {
		p := ParseAddress(c.addr, c.city)
		if len(p.Streets) == 0 || p.Streets[0] != c.street || p.Num != c.num || p.Suf != c.suf {
			t.Errorf("ParseAddress(%q) = %+v, want street %q num %d suf %q", c.addr, p, c.street, c.num, c.suf)
		}
	}
	if p := ParseAddress("מרכז מסחרי הרצל 5", "נתניה"); !contains(p.Streets, "הרצל") {
		t.Errorf("generic prefix not stripped: %+v", p.Streets)
	}
	if p := ParseAddress("כצנלסון/מנדל 67", "חיפה"); !contains(p.Streets, "מנדל") {
		t.Errorf("slash alternative missing: %+v", p.Streets)
	}
	if p := ParseAddress("https://example.com", "חיפה"); len(p.Streets) != 0 {
		t.Errorf("url should not parse: %+v", p)
	}
}

func TestEditDist(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{{"הרצל", "הרצל", true}, {"הרצל", "הרצול", true}, {"הרצל", "הרצר", true}, {"הרצל", "הרצלי", true}, {"הרצל", "הרצליה", false}, {"אבג", "דהו", false}} {
		if editDistLE1(c.a, c.b) != c.want {
			t.Errorf("editDistLE1(%q,%q) != %v", c.a, c.b, c.want)
		}
	}
}

func mu(v float64) int32 { return int32(math.Round(v * micro)) }

// testIndex has two neighbouring cities that both own a "הרצל" street, with houses on one.
func testIndex() *Index {
	ix := &Index{
		Cities: []City{
			{Name: "רמת גן", Names: []string{"רמת גן"}, Lat: mu(32.08), Lon: mu(34.81)},
			{Name: "גבעתיים", Names: []string{"גבעתיים"}, Lat: mu(32.07), Lon: mu(34.81)},
		},
		Streets: []Street{
			{City: 0, Names: []string{"הרצל", "בנימין הרצל"}, Lat: mu(32.0800), Lon: mu(34.8100), Houses: []House{
				{Num: 2, Lat: mu(32.0800), Lon: mu(34.8100)},
				{Num: 10, Lat: mu(32.0840), Lon: mu(34.8100)},
				{Num: 12, Suf: "א", Lat: mu(32.0850), Lon: mu(34.8100)},
				{Num: 30, Lat: mu(32.0900), Lon: mu(34.8100)},
			}},
			{City: 1, Names: []string{"הרצל"}, Lat: mu(32.0700), Lon: mu(34.8100)},
			{City: 0, Names: []string{"ז'בוטינסקי"}, Lat: mu(32.0850), Lon: mu(34.8200)}, // unnormalised on purpose: never matches
			{City: 0, Names: []string{"זבוטינסקי"}, Lat: mu(32.0850), Lon: mu(34.8200)},
			{City: 0, Names: []string{"יהושע חנקין"}, Lat: mu(32.0820), Lon: mu(34.8150)},
			{City: 0, Names: []string{"ויצמן"}, Lat: mu(32.0830), Lon: mu(34.8300), Houses: []House{
				{Num: 1, Lat: mu(32.0830), Lon: mu(34.8300)},
				{Num: 101, Lat: mu(32.0830), Lon: mu(34.8900)}, // far apart: do not interpolate
			}},
		},
		POIs: []POI{{City: 0, Name: "עזריאלי", Lat: mu(32.0740), Lon: mu(34.8010)}},
	}
	ix.Prepare()
	return ix
}

func near(a, b float64) bool { return math.Abs(a-b) < 2e-6 }

func TestLookupHouseExact(t *testing.T) {
	ix := testIndex()
	lat, lon, prec, ok := ix.Lookup("רח' הרצל 10", "רמת-גן")
	if !ok || prec != PrecHouse || !near(lat, 32.0840) || !near(lon, 34.81) {
		t.Fatalf("got %v %v %s %v", lat, lon, prec, ok)
	}
	// suffix
	lat, _, prec, _ = ix.Lookup("הרצל 12א", `ר"ג`)
	if prec != PrecHouse || !near(lat, 32.0850) {
		t.Fatalf("suffix lookup: %v %s", lat, prec)
	}
	// alias name
	if _, _, prec, ok := ix.Lookup("בנימין הרצל 2", "רמת גן"); !ok || prec != PrecHouse {
		t.Fatalf("alias lookup: %s %v", prec, ok)
	}
}

func TestLookupInterpolation(t *testing.T) {
	ix := testIndex()
	// 20 is between 12 (32.0850) and 30 (32.0900): 8/18 of the way
	lat, _, prec, ok := ix.Lookup("הרצל 20", "רמת גן")
	want := 32.0850 + (8.0/18.0)*0.005
	if !ok || prec != PrecHouse || math.Abs(lat-want) > 1e-5 {
		t.Fatalf("interpolated %v (%s), want %v", lat, prec, want)
	}
	r, _ := ix.LookupDetail("הרצל 20", "רמת גן")
	if r.Method != "interpolated" {
		t.Errorf("method %q", r.Method)
	}
}

func TestLookupStreetFallback(t *testing.T) {
	ix := testIndex()
	// no house numbers on this street
	lat, lon, prec, ok := ix.Lookup("זבוטינסקי 5", "רמת גן")
	if !ok || prec != PrecStreet || !near(lat, 32.0850) || !near(lon, 34.82) {
		t.Fatalf("got %v %v %s %v", lat, lon, prec, ok)
	}
	// neighbours too far apart to interpolate: street level, not a made-up house
	_, _, prec, _ = ix.Lookup("ויצמן 50", "רמת גן")
	if prec != PrecStreet {
		t.Errorf("expected street for far-apart neighbours, got %s", prec)
	}
	// number far beyond the known range
	if _, _, prec, _ = ix.Lookup("הרצל 900", "רמת גן"); prec != PrecStreet {
		t.Errorf("expected street, got %s", prec)
	}
}

func TestLookupTypoAndSpelling(t *testing.T) {
	ix := testIndex()
	// vav variant -> skeleton
	if _, _, prec, ok := ix.Lookup("יהושוע חנקין 14", "רמת גן"); !ok || prec != PrecStreet {
		t.Errorf("skeleton: %s %v", prec, ok)
	}
	// one-letter typo in a 5+ letter name
	r, ok := ix.LookupDetail("זבוטינסקט 3", "רמת גן")
	if !ok || r.Precision != PrecStreet || r.Method != "centroid+typo" {
		t.Errorf("typo: %+v %v", r, ok)
	}
	// but not for short names: "הרצ" must not become "הרצל"
	if r, _ := ix.LookupDetail("הרצ 3", "רמת גן"); r.Precision == PrecHouse {
		t.Errorf("short name typo should not match: %+v", r)
	}
	// and never across cities: גבעתיים has no ויצמן
	if r, _ := ix.LookupDetail("ויצמן 1", "גבעתיים"); r.Precision != PrecCity {
		t.Errorf("street from another city leaked: %+v", r)
	}
}

func TestLookupCityDisambiguation(t *testing.T) {
	ix := testIndex()
	lat1, _, _, _ := ix.Lookup("הרצל 10", "רמת גן")
	lat2, _, prec2, _ := ix.Lookup("הרצל 10", "גבעתיים")
	if near(lat1, lat2) {
		t.Fatal("same coordinates for two cities")
	}
	if !near(lat2, 32.0700) || prec2 != PrecStreet {
		t.Errorf("givatayim: %v %s", lat2, prec2)
	}
}

func TestLookupPOIAndCity(t *testing.T) {
	ix := testIndex()
	lat, _, prec, ok := ix.Lookup("קניון עזריאלי", "רמת גן")
	if !ok || prec != PrecPOI || !near(lat, 32.0740) {
		t.Errorf("poi: %v %s %v", lat, prec, ok)
	}
	lat, _, prec, ok = ix.Lookup("מרכז קניות נטו", "גבעתיים")
	if !ok || prec != PrecCity || !near(lat, 32.07) {
		t.Errorf("city fallback: %v %s %v", lat, prec, ok)
	}
	if _, _, _, ok = ix.Lookup("הרצל 1", "עיר שלא קיימת"); ok {
		t.Error("unknown city should not resolve")
	}
}

func TestBranchLookup(t *testing.T) {
	ix := testIndex()
	ix.Brands = []Brand{
		{City: 0, Brand: "שופרסל", Name: "שופרסל דיל", Lat: mu(32.09), Lon: mu(34.81)},
		{City: 1, Brand: "שופרסל", Name: "שופרסל שלי", Lat: mu(32.07), Lon: mu(34.80)},
		{City: 1, Brand: "שופרסל", Name: "שופרסל אקספרס כצנלסון", Lat: mu(32.071), Lon: mu(34.81)},
	}
	ix.Prepare()
	if r, ok := ix.LookupBranch("שופרסל", "שופרסל דיל רמת גן", "רמת גן", "הרצל 3"); !ok || !near(r.Lat, 32.09) {
		t.Errorf("unique branch: %+v %v", r, ok)
	}
	if _, ok := ix.LookupBranch("שופרסל", "שופרסל גבעתיים", "גבעתיים", "הרצל 3"); ok {
		t.Error("ambiguous branch should not match")
	}
	if r, ok := ix.LookupBranch("שופרסל", "שופרסל אקספרס כצנלסון", "גבעתיים", "כצנלסון 3"); !ok || !near(r.Lat, 32.071) {
		t.Errorf("name-disambiguated branch: %+v %v", r, ok)
	}
}

func TestWriteLoadRoundTrip(t *testing.T) {
	ix := testIndex()
	ix.Brands = []Brand{{City: 0, Brand: "שופרסל", Name: "שופרסל דיל", Lat: mu(32.09), Lon: mu(34.81)}}
	ix.Prepare()
	var buf bytes.Buffer
	if err := ix.Write(&buf); err != nil {
		t.Fatal(err)
	}
	ix2, err := Load(&buf)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range [][2]string{{"הרצל 10", "רמת גן"}, {"הרצל 20", "רמת גן"}, {"הרצל 12א", "רמת גן"}, {"הרצל 1", "גבעתיים"}, {"קניון עזריאלי", "רמת גן"}, {"זבוטנסקי 1", "רמת גן"}} {
		a1, o1, p1, k1 := ix.Lookup(q[0], q[1])
		a2, o2, p2, k2 := ix2.Lookup(q[0], q[1])
		if a1 != a2 || o1 != o2 || p1 != p2 || k1 != k2 {
			t.Errorf("%v: before %v %v %s %v, after %v %v %s %v", q, a1, o1, p1, k1, a2, o2, p2, k2)
		}
	}
	if len(ix2.Brands) != 1 || len(ix2.Cities) != 2 {
		t.Errorf("round trip lost data: %d brands %d cities", len(ix2.Brands), len(ix2.Cities))
	}
	if _, err := Load(bytes.NewReader([]byte("not gzip"))); err == nil {
		t.Error("garbage should not load")
	}
}

func TestConcurrentLookups(t *testing.T) {
	ix := testIndex()
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 200; i++ {
				if _, _, prec, ok := ix.Lookup("הרצל 10", "רמת גן"); !ok || prec != PrecHouse {
					t.Error("bad concurrent lookup")
					return
				}
			}
		}()
	}
	wg.Wait()
}

func sq(x0, y0, x1, y1 float64) []ptf {
	return []ptf{{x0, y0}, {x1, y0}, {x1, y1}, {x0, y1}, {x0, y0}}
}

// Two adjacent municipalities sharing a border; a nearest-place-node rule would get the
// point near the border wrong, polygons do not.
func TestBoundaryDisambiguation(t *testing.T) {
	bd := NewBoundaries()
	bd.Add(0, [][]ptf{sq(34.80, 32.00, 34.82, 32.10)}, nil)                                 // west city
	bd.Add(1, [][]ptf{sq(34.82, 32.00, 34.90, 32.10)}, nil)                                 // east city
	bd.Add(2, [][]ptf{sq(35.0, 32.0, 35.2, 32.2)}, [][]ptf{sq(35.05, 32.05, 35.15, 32.15)}) // with an enclave hole
	bd.Add(3, [][]ptf{sq(35.05, 32.05, 35.15, 32.15)}, nil)                                 // the enclave city
	bd.Build()
	for _, c := range []struct {
		lat, lon float64
		want     int32
		ok       bool
	}{
		{32.05, 34.8199, 0, true}, {32.05, 34.8201, 1, true}, {32.05, 34.95, 0, false},
		{32.01, 35.01, 2, true}, {32.10, 35.10, 3, true},
	} {
		got, ok := bd.Find(c.lat, c.lon)
		if ok != c.ok || (ok && got != c.want) {
			t.Errorf("Find(%v,%v) = %d,%v want %d,%v", c.lat, c.lon, got, ok, c.want, c.ok)
		}
	}
}

func TestStitchRings(t *testing.T) {
	// a square made of three ways, one stored backwards
	rings := stitch([][]int64{{1, 2, 3}, {5, 4, 3}, {5, 6, 1}})
	if len(rings) != 1 || len(rings[0]) != 7 || rings[0][0] != rings[0][len(rings[0])-1] {
		t.Fatalf("stitch: %v", rings)
	}
	if len(stitch([][]int64{{1, 2, 3}})) != 0 {
		t.Error("open way must not become a ring")
	}
	lat, lon := RingCentroid(sq(34.0, 32.0, 35.0, 33.0))
	if math.Abs(lat-32.5) > 1e-9 || math.Abs(lon-34.5) > 1e-9 {
		t.Errorf("centroid %v %v", lat, lon)
	}
}

func TestEvaluateReport(t *testing.T) {
	ix := testIndex()
	r := Evaluate(ix, []EvalStore{
		{Addr: "הרצל 10", City: "רמת גן", Lat: 32.0841, Lon: 34.8101},
		{Addr: "זבוטינסקי 5", City: "רמת גן", Lat: 33, Lon: 35},
		{Addr: "קניון עזריאלי", City: "רמת גן"},
		{Addr: "xyz", City: "בלי עיר"},
		{Addr: "", City: "רמת גן"},
	}, true)
	if r.Total != 4 || r.House != 1 || r.Street != 1 || r.POI != 1 || r.Miss != 1 || r.Agree != 1 || r.Compared != 2 {
		t.Errorf("unexpected report: %+v", r)
	}
	if s := r.String(); len(s) == 0 {
		t.Error("empty report")
	}
}
