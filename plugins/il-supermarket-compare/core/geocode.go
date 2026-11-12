package core

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Geocoder looks Israeli addresses up on public OpenStreetMap geocoders. It spreads lookups over
// several services (Nominatim, Photon), each held to its own usage policy: at most one request per
// second per service, an identifying User-Agent, and a permanent cache (misses included), so each
// address is only ever asked once. If one service fails, another answers.
type Geocoder struct {
	CacheFile string
	Client    *http.Client
	Providers []*GeoProvider

	mu    sync.Mutex // guards cache and dirty
	cache map[string]*[2]float64
	dirty int
}

// GeoProvider is one geocoding service.
type GeoProvider struct {
	Name   string
	MinGap time.Duration // the service's rate limit
	Search func(ctx context.Context, c *http.Client, q string) ([]nominatimHit, error)

	mu   sync.Mutex
	next time.Time // earliest time the next request may start
}

// reserve books this provider's next request slot and returns how long to wait for it.
func (p *GeoProvider) reserve() time.Duration {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	if p.next.Before(now) {
		p.next = now
	}
	wait := p.next.Sub(now)
	p.next = p.next.Add(p.MinGap)
	return wait
}

func (p *GeoProvider) freeAt() time.Time {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.next
}

// DefaultGeoProviders are used unless SALZOL_GEOCODERS names a subset ("nominatim,photon").
func DefaultGeoProviders() []*GeoProvider {
	all := map[string]*GeoProvider{
		"nominatim": {Name: "nominatim", MinGap: 1100 * time.Millisecond, Search: nominatimSearch},
		"photon":    {Name: "photon", MinGap: 1100 * time.Millisecond, Search: photonSearch},
	}
	names := []string{"nominatim", "photon"}
	if env := strings.TrimSpace(os.Getenv("SALZOL_GEOCODERS")); env != "" {
		names = strings.Split(env, ",")
	}
	var out []*GeoProvider
	for _, n := range names {
		if p, ok := all[strings.TrimSpace(n)]; ok {
			out = append(out, p)
		}
	}
	return out
}

func NewGeocoder(cacheFile string) *Geocoder {
	g := &Geocoder{CacheFile: cacheFile, Client: &http.Client{Timeout: 30 * time.Second}, cache: map[string]*[2]float64{}, Providers: DefaultGeoProviders()}
	if b, err := os.ReadFile(cacheFile); err == nil {
		json.Unmarshal(b, &g.cache)
	}
	return g
}

// Lookup returns [lat, lon] for an Israeli address. found=false means the services don't know it
// (cached); an error means none of them could be reached (not cached, so it's retried later).
// Safe for concurrent use: concurrent lookups go to different services.
func (g *Geocoder) Lookup(ctx context.Context, q string) ([2]float64, bool, error) {
	q = strings.Join(strings.Fields(q), " ")
	g.mu.Lock()
	if v, ok := g.cache[q]; ok {
		g.mu.Unlock()
		if v == nil {
			return [2]float64{}, false, nil
		}
		return *v, true, nil
	}
	g.mu.Unlock()

	// Try the service that frees up first; fall back to the others on failure.
	order := append([]*GeoProvider(nil), g.Providers...)
	sort.SliceStable(order, func(i, j int) bool { return order[i].freeAt().Before(order[j].freeAt()) })
	var lastErr error = fmt.Errorf("no geocoding service configured")
	for _, p := range order {
		if wait := p.reserve(); wait > 0 {
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				return [2]float64{}, false, ctx.Err()
			}
		}
		hits, err := p.Search(ctx, g.Client, q)
		if err != nil {
			lastErr = fmt.Errorf("%s: %w", p.Name, err)
			continue
		}
		var v *[2]float64
		if hit := pickHit(hits, q); hit != nil {
			lat, _ := strconv.ParseFloat(hit.Lat, 64)
			lon, _ := strconv.ParseFloat(hit.Lon, 64)
			v = &[2]float64{lat, lon}
		}
		g.mu.Lock()
		g.cache[q] = v
		if g.dirty++; g.dirty >= 20 {
			g.saveLocked()
		}
		g.mu.Unlock()
		if v == nil {
			return [2]float64{}, false, nil
		}
		return *v, true, nil
	}
	return [2]float64{}, false, lastErr
}

func nominatimSearch(ctx context.Context, c *http.Client, q string) ([]nominatimHit, error) {
	u := "https://nominatim.openstreetmap.org/search?" + url.Values{"q": {q}, "format": {"json"}, "limit": {"5"}, "countrycodes": {"il"}, "addressdetails": {"1"}}.Encode()
	req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept-Language", "he")
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var r []nominatimHit
	return r, json.NewDecoder(resp.Body).Decode(&r)
}

// photonSearch queries komoot's public Photon instance (OpenStreetMap data), limited to Israel's
// bounding box, and maps its GeoJSON to the same shape as Nominatim's results.
func photonSearch(ctx context.Context, c *http.Client, q string) ([]nominatimHit, error) {
	u := "https://photon.komoot.io/api?" + url.Values{"q": {q}, "limit": {"5"}, "bbox": {"34.2,29.4,35.9,33.4"}}.Encode()
	req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
	req.Header.Set("User-Agent", userAgent)
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var r struct {
		Features []struct {
			Geometry struct {
				Coordinates []float64 `json:"coordinates"`
			} `json:"geometry"`
			Properties map[string]any `json:"properties"`
		} `json:"features"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	var out []nominatimHit
	for _, f := range r.Features {
		if len(f.Geometry.Coordinates) < 2 {
			continue
		}
		if cc, _ := f.Properties["countrycode"].(string); cc != "" && cc != "IL" && cc != "PS" {
			continue
		}
		addr := map[string]string{}
		for _, k := range []string{"city", "town", "village", "county", "district", "state", "street", "housenumber"} {
			if v, ok := f.Properties[k].(string); ok {
				addr[k] = v
			}
		}
		out = append(out, nominatimHit{
			Lat:     strconv.FormatFloat(f.Geometry.Coordinates[1], 'f', -1, 64),
			Lon:     strconv.FormatFloat(f.Geometry.Coordinates[0], 'f', -1, 64),
			Address: addr,
		})
	}
	return out, nil
}

type nominatimHit struct {
	Lat     string            `json:"lat"`
	Lon     string            `json:"lon"`
	Address map[string]string `json:"address"`
}

// pickHit chooses the result in the city the query names (its last comma-separated part).
// Nominatim matches a city name anywhere in the hierarchy, so "הרצל 10, חיפה" can rank Herzl 10 in
// Hadera (which is in Haifa *District*) above Herzl Street in Haifa itself.
func pickHit(hits []nominatimHit, q string) *nominatimHit {
	if len(hits) == 0 {
		return nil
	}
	parts := strings.Split(q, ",")
	if len(parts) < 2 {
		return &hits[0]
	}
	city := normCity(parts[len(parts)-1])
	if city == "" || city == normCity("ישראל") {
		return &hits[0]
	}
	for i := range hits {
		for _, k := range []string{"city", "town", "village", "municipality", "hamlet", "suburb"} {
			if c := normCity(hits[i].Address[k]); c != "" && (c == city || strings.Contains(c, city) || strings.Contains(city, c)) {
				return &hits[i]
			}
		}
	}
	return nil // nothing in that city: better no answer than the wrong town
}

func normCity(s string) string {
	s = strings.NewReplacer("-", " ", "–", " ", "\"", "", "״", "", "'", "", "׳", "").Replace(s)
	return strings.Join(strings.Fields(s), " ")
}

// Save writes the cache to disk.
func (g *Geocoder) Save() error {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.saveLocked()
}

func (g *Geocoder) saveLocked() error {
	g.dirty = 0
	if g.CacheFile == "" {
		return nil
	}
	os.MkdirAll(filepath.Dir(g.CacheFile), 0o755)
	return writeJSON(g.CacheFile, g.cache)
}

var (
	parenRx  = regexp.MustCompile(`\(.*?\)`)
	streetRx = regexp.MustCompile(`(^|\s)(רח(וב)?['.]?|שד(רות)?['.]?)\s*`)
	abbrRx   = regexp.MustCompile(`ר"ג|ת"א|ב"ב|פינת.*|מ\.מסחרי|מרכז מסחרי|קניון`)
	numRx    = regexp.MustCompile(`\d+[-\d]*`)
)

// cleanAddress normalizes the messy store-file addresses ("רח' הרוא\"ה 152", "ירושלים  70", "תרצה 19 ר\"ג").
func cleanAddress(addr, city string) string {
	a := parenRx.ReplaceAllString(addr, " ")
	a = streetRx.ReplaceAllString(a, " ")
	a = abbrRx.ReplaceAllString(a, " ")
	if city != "" {
		a = strings.ReplaceAll(a, city, " ")
	}
	a = strings.NewReplacer(`"`, "", "״", "").Replace(a)
	return strings.Trim(strings.Join(strings.Fields(a), " "), " ,-")
}

// LocateStore tries progressively looser queries. ok=false means only the city centre was found.
func (g *Geocoder) LocateStore(ctx context.Context, addr, city string) (ll [2]float64, exact, ok bool) {
	if city == "" {
		return
	}
	if addr != "" && !strings.HasPrefix(addr, "http") {
		// The offline index knows more Israeli streets than the online services and costs nothing.
		if ll, ok := offlinePlace(addr, city); ok {
			return ll, true, true
		}
		a := cleanAddress(addr, city)
		tries := []string{addr + ", " + city, a + ", " + city}
		if street := strings.TrimSpace(numRx.ReplaceAllString(a, "")); street != "" && street != a {
			tries = append(tries, street+", "+city)
		}
		seen := map[string]bool{}
		centre, hasCentre, _ := g.Lookup(ctx, city+", ישראל")
		for _, q := range tries {
			if seen[q] || strings.TrimSpace(strings.Trim(q, ", ")) == city {
				continue
			}
			seen[q] = true
			v, found, err := g.Lookup(ctx, q)
			if err != nil || !found {
				continue
			}
			// A street match far from the city centre is the same street name in another town.
			if hasCentre && Km(v[0], v[1], centre[0], centre[1]) > maxFromCentreKm {
				continue
			}
			return v, true, true
		}
	}
	if v, found, err := g.Lookup(ctx, city+", ישראל"); err == nil && found {
		return v, false, true
	}
	return
}

// maxFromCentreKm bounds how far a branch can be from its city's centre; Jerusalem, the widest
// city, spans about 10 km from its centre.
const maxFromCentreKm = 10.0

// Km is the great-circle distance between two points.
func Km(lat1, lon1, lat2, lon2 float64) float64 {
	r := math.Pi / 180
	p1, p2 := lat1*r, lat2*r
	dp, dl := p2-p1, (lon2-lon1)*r
	return 2 * 6371 * math.Asin(math.Sqrt(math.Sin(dp/2)*math.Sin(dp/2)+math.Cos(p1)*math.Cos(p2)*math.Sin(dl/2)*math.Sin(dl/2)))
}
