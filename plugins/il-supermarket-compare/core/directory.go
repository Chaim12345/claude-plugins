package core

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DirStore is one branch in the national store directory.
type DirStore struct {
	Chain   string  `json:"c"`                // portal key
	StoreID string  `json:"id"`               // as in the chain's files
	Banner  string  `json:"b"`                // display name: "רמי לוי", "שופרסל שלי", "יש חסד", ...
	Name    string  `json:"n"`                // branch name from the Stores file
	Address string  `json:"a"`                // street address
	City    string  `json:"city"`             // Hebrew city name
	Lat     float64 `json:"lat"`              // 0 when unknown
	Lon     float64 `json:"lon"`              //
	Approx  bool    `json:"approx,omitempty"` // coordinates are the city centre
}

func (d DirStore) Key() string { return d.Chain + ":" + d.StoreID }

// Directory is every known branch with coordinates. Building it geocodes ~1,000 addresses at
// Nominatim's 1 request/second, so it's built once (salzol directory), shipped embedded in the
// binary and the phone library, and refreshed occasionally.
type Directory struct {
	Built  string     `json:"built"`
	Stores []DirStore `json:"stores"`
}

//go:embed directory.json
var embeddedDirectory []byte

// DefaultDirectory returns the directory compiled into this build.
func DefaultDirectory() (*Directory, error) {
	var d Directory
	if err := json.Unmarshal(embeddedDirectory, &d); err != nil {
		return nil, fmt.Errorf("embedded directory: %w", err)
	}
	return &d, nil
}

// ---------------- banners ----------------

var shufersalBanners = map[string]string{
	"שלי": "שופרסל שלי", "דיל": "שופרסל דיל", "אקספרס": "שופרסל אקספרס", "יוניברס": "שופרסל יוניברס",
	"יש": "יש חסד", "גוד": "גוד מרקט", "BE": "BE", "שופרסל": "שופרסל",
}

// banner returns the display banner for a store row. Shufersal and Carrefour run several formats
// with very different prices, so their banner comes from the branch name.
func banner(chain string, r StoreRow) string {
	name := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(r.Name, "שופרסל", ""), "קרפור", ""))
	first := ""
	if f := strings.Fields(strings.NewReplacer("-", " ", "–", " ").Replace(name)); len(f) > 0 {
		first = f[0]
	}
	switch chain {
	case "shufersal":
		if b, ok := shufersalBanners[first]; ok {
			return b
		}
		if strings.Contains(r.Name, "אקספרס") {
			return "שופרסל אקספרס"
		}
		return "שופרסל"
	case "carrefour":
		switch {
		case strings.Contains(r.Name, "סיטי") || strings.Contains(strings.ToLower(r.Name), "city"):
			return "קרפור סיטי"
		case strings.Contains(r.Name, "מרקט") || strings.Contains(strings.ToLower(r.Name), "market"):
			return "קרפור מרקט"
		case strings.Contains(r.Name, "היפר") || strings.Contains(strings.ToLower(r.Name), "hyper"):
			return "קרפור היפר"
		}
		return "קרפור"
	}
	if n, ok := ChainNames[chain]; ok {
		return n
	}
	return chain
}

// DiscountBanners price branch by branch (Rami Levy Bnei Brak was ~18% below Rami Levy Givatayim),
// so every branch in range is worth comparing, not just the nearest.
var DiscountBanners = map[string]bool{
	"רמי לוי": true, "אושר עד": true, "יוחננוף": true, "קשת טעמים": true, "יש חסד": true,
	"שופרסל יוניברס": true, "שופרסל דיל": true, "קרפור היפר": true,
	"ויקטורי": true, "מחסני השוק": true, "חצי חינם": true, "סופר יודה": true, "יילו": true,
}

var notSupermarketRx = regexp.MustCompile(`(?i)(^|\s)BE(\s|$)|אונליין|online|@|https?://|מרלוג|מחסן`)

// ---------------- building ----------------

// CityNames maps CBS locality codes to Hebrew names (store files often give the city as a code).
func CityNames(ctx context.Context, client *http.Client) (map[string]string, error) {
	if client == nil {
		client = &http.Client{Timeout: time.Minute}
	}
	u := "https://data.gov.il/api/3/action/datastore_search?resource_id=5c78e9fa-c2e2-4771-93ff-7f400a12f7ba&limit=5000"
	resp, err := get(ctx, client, u)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var r struct {
		Result struct {
			Records []map[string]any `json:"records"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, rec := range r.Result.Records {
		code := strings.TrimLeft(strings.TrimSpace(fmt.Sprint(rec["סמל_ישוב"])), "0")
		name := strings.TrimSpace(fmt.Sprint(rec["שם_ישוב"]))
		if code != "" && name != "" {
			out[code] = name
		}
	}
	return out, nil
}

// cityFor resolves a store's city: a code, a name, or (when the field is empty or "0") a city
// name found inside the branch name ("קולינריק רמת גן").
func cityFor(r StoreRow, codes map[string]string, names []string) string {
	c := strings.TrimSpace(r.City)
	if _, err := strconv.Atoi(c); err == nil {
		c = codes[strings.TrimLeft(c, "0")]
	}
	// A branch named exactly after a city is in that city, whatever the city field says
	// (Rami Levy's "אור עקיבא" branch lists Haifa as its city).
	if n := normCity(r.Name); n != "" && n != normCity(c) {
		for _, name := range names {
			if normCity(name) == n {
				return name
			}
		}
	}
	if c != "" {
		return c
	}
	for _, n := range names { // longest first, so "תל אביב - יפו" beats "יפו"
		if strings.Contains(r.Name, n) || strings.Contains(r.Address, n) {
			return n
		}
	}
	return ""
}

// BuildDirectory downloads every chain's Stores file and geocodes each branch. Chains that fail are
// reported through onEvent and left out. Geocodes are cached in geo, so a rebuild only asks about
// new branches.
func BuildDirectory(ctx context.Context, chains []string, geo *Geocoder, client *http.Client, onEvent func(Event)) (*Directory, error) {
	emit := func(e Event) {
		if onEvent != nil {
			onEvent(e)
		}
	}
	codes, err := CityNames(ctx, client)
	if err != nil {
		emit(Event{Phase: "skip", Message: "city codes: " + err.Error()})
		codes = map[string]string{}
	}
	names := make([]string, 0, len(codes))
	for _, n := range codes {
		if len([]rune(n)) >= 3 {
			names = append(names, n)
		}
	}
	sort.Slice(names, func(i, j int) bool { return len(names[i]) > len(names[j]) })

	var mu sync.Mutex
	var rows []StoreRow
	var wg sync.WaitGroup
	for _, ch := range chains {
		wg.Add(1)
		go func(ch string) {
			defer wg.Done()
			p, err := NewPortal(ch, client)
			var rs []StoreRow
			if err == nil {
				rs, err = p.Stores(ctx)
			}
			if err != nil {
				emit(Event{Phase: "skip", Store: ch, Message: err.Error()})
				return
			}
			emit(Event{Phase: "stores", Store: ch, Items: len(rs)})
			mu.Lock()
			rows = append(rows, rs...)
			mu.Unlock()
		}(ch)
	}
	wg.Wait()
	sort.Slice(rows, func(i, j int) bool { return rows[i].Chain+rows[i].StoreID < rows[j].Chain+rows[j].StoreID })

	d := &Directory{Built: time.Now().UTC().Format(time.RFC3339)}
	// Locate branches concurrently, one worker per geocoding service, so each service runs at its
	// own rate limit. Results keep the input order.
	out := make([]*DirStore, len(rows))
	workers := len(geo.Providers)
	if workers < 1 {
		workers = 1
	}
	jobs := make(chan int)
	var done int64
	var dmu sync.Mutex
	var gwg sync.WaitGroup
	for w := 0; w < workers; w++ {
		gwg.Add(1)
		go func() {
			defer gwg.Done()
			for i := range jobs {
				r := rows[i]
				city := cityFor(r, codes, names)
				s := DirStore{Chain: r.Chain, StoreID: r.StoreID, Banner: banner(r.Chain, r), Name: r.Name, Address: r.Address, City: city}
				if ll, exact, ok := geo.LocateStore(ctx, r.Address, city); ok {
					s.Lat, s.Lon, s.Approx = ll[0], ll[1], !exact
				}
				out[i] = &s
				dmu.Lock()
				done++
				if done%25 == 0 {
					emit(Event{Phase: "geocode", Items: int(done), Message: fmt.Sprintf("%d/%d", done, len(rows))})
				}
				dmu.Unlock()
			}
		}()
	}
	for i, r := range rows {
		if notSupermarketRx.MatchString(r.Name+" "+r.Address) || banner(r.Chain, r) == "BE" {
			continue
		}
		select {
		case jobs <- i:
		case <-ctx.Done():
		}
		if ctx.Err() != nil {
			break
		}
	}
	close(jobs)
	gwg.Wait()
	geo.Save()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	for _, s := range out {
		if s != nil {
			d.Stores = append(d.Stores, *s)
		}
	}
	return d, nil
}

// ---------------- choosing stores ----------------

// Nearby picks the stores worth comparing around a point: every discount-banner branch within the
// radius, plus the nearest branch of each other banner, closest first, at most max stores.
// Branches placed only at their city centre count only when well inside the radius, since the
// centre can be a few km off.
func (d *Directory) Nearby(lat, lon, radiusKm float64, max int) []NearStore {
	var cands []NearStore
	for _, s := range d.Stores {
		if s.Lat == 0 && s.Lon == 0 {
			continue
		}
		km := Km(lat, lon, s.Lat, s.Lon)
		limit := radiusKm
		if s.Approx {
			limit = radiusKm - 1.5
		}
		if km <= limit {
			cands = append(cands, NearStore{DirStore: s, Km: km})
		}
	}
	sort.Slice(cands, func(i, j int) bool { return cands[i].Km < cands[j].Km })
	seen := map[string]int{}
	var out []NearStore
	for _, c := range cands {
		if !DiscountBanners[c.Banner] && seen[c.Banner] >= 1 {
			continue
		}
		seen[c.Banner]++
		out = append(out, c)
		if max > 0 && len(out) >= max {
			break
		}
	}
	return out
}

type NearStore struct {
	DirStore
	Km float64 `json:"km"`
}

// ConfigFor turns a chosen set of stores into a sync config centred on the user's location.
func ConfigFor(stores []NearStore, place string, lat, lon float64) Config {
	cfg := Config{MinStores: 3, Areas: []Area{{Name: place, Lat: lat, Lon: lon}}}
	if len(stores) < 3 {
		cfg.MinStores = 2
	}
	for _, s := range stores {
		la, lo := s.Lat, s.Lon
		cfg.Stores = append(cfg.Stores, StoreRef{Chain: s.Chain, StoreID: s.StoreID, ChainName: s.Banner, Branch: branchLabel(s.DirStore),
			Address: strings.Trim(s.Address+", "+s.City, ", "), Lat: &la, Lon: &lo, Approx: s.Approx})
	}
	return cfg
}

// branchLabel strips the banner words from the branch name: "שלי רמת גן- ביאליק" -> "רמת גן- ביאליק".
func branchLabel(s DirStore) string {
	n := s.Name
	for _, w := range append(strings.Fields(s.Banner), "שופרסל", "קרפור") {
		n = strings.Replace(n, w, "", 1)
	}
	n = strings.Trim(strings.Join(strings.Fields(n), " "), " -")
	if n == "" {
		return s.City
	}
	return n
}

// CityCentre estimates a city's centre from the directory's branches there: the mean of its
// street-level branches, else of its city-centre placeholders. It needs no network, so the phone
// can use it to sanity-check what its own geocoder returns.
func (d *Directory) CityCentre(city string) (lat, lon float64, ok bool) {
	want := normCity(city)
	if want == "" {
		return 0, 0, false
	}
	var sx, sy, ax, ay float64
	var n, an int
	for _, s := range d.Stores {
		if s.Lat == 0 || normCity(s.City) != want {
			continue
		}
		if s.Approx {
			ax, ay, an = ax+s.Lat, ay+s.Lon, an+1
		} else {
			sx, sy, n = sx+s.Lat, sy+s.Lon, n+1
		}
	}
	switch {
	case n > 0:
		return sx / float64(n), sy / float64(n), true
	case an > 0:
		return ax / float64(an), ay / float64(an), true
	}
	return 0, 0, false
}
