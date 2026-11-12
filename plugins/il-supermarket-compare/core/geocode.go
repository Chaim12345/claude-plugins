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
	"strconv"
	"strings"
	"sync"
	"time"
)

// Geocoder looks addresses up on OpenStreetMap Nominatim. It respects Nominatim's usage policy:
// at most one request per second, an identifying User-Agent, and a permanent cache (misses included),
// so each address is only ever asked once.
type Geocoder struct {
	CacheFile string
	Client    *http.Client

	mu    sync.Mutex
	cache map[string]*[2]float64
	last  time.Time
	dirty int
}

func NewGeocoder(cacheFile string) *Geocoder {
	g := &Geocoder{CacheFile: cacheFile, Client: &http.Client{Timeout: 30 * time.Second}, cache: map[string]*[2]float64{}}
	if b, err := os.ReadFile(cacheFile); err == nil {
		json.Unmarshal(b, &g.cache)
	}
	return g
}

// Lookup returns [lat, lon] for an Israeli address, or nil if Nominatim doesn't know it.
func (g *Geocoder) Lookup(ctx context.Context, q string) ([2]float64, bool, error) {
	q = strings.Join(strings.Fields(q), " ")
	g.mu.Lock()
	defer g.mu.Unlock()
	if v, ok := g.cache[q]; ok {
		if v == nil {
			return [2]float64{}, false, nil
		}
		return *v, true, nil
	}
	if wait := 1100*time.Millisecond - time.Since(g.last); wait > 0 {
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return [2]float64{}, false, ctx.Err()
		}
	}
	u := "https://nominatim.openstreetmap.org/search?" + url.Values{"q": {q}, "format": {"json"}, "limit": {"1"}, "countrycodes": {"il"}}.Encode()
	req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept-Language", "he")
	resp, err := g.Client.Do(req)
	g.last = time.Now()
	if err != nil {
		return [2]float64{}, false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return [2]float64{}, false, fmt.Errorf("nominatim: HTTP %d", resp.StatusCode)
	}
	var r []struct {
		Lat string `json:"lat"`
		Lon string `json:"lon"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return [2]float64{}, false, err
	}
	var v *[2]float64
	if len(r) > 0 {
		lat, _ := strconv.ParseFloat(r[0].Lat, 64)
		lon, _ := strconv.ParseFloat(r[0].Lon, 64)
		v = &[2]float64{lat, lon}
	}
	g.cache[q] = v
	if g.dirty++; g.dirty >= 20 {
		g.saveLocked()
	}
	if v == nil {
		return [2]float64{}, false, nil
	}
	return *v, true, nil
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
		a := cleanAddress(addr, city)
		tries := []string{addr + ", " + city, a + ", " + city}
		if street := strings.TrimSpace(numRx.ReplaceAllString(a, "")); street != "" && street != a {
			tries = append(tries, street+", "+city)
		}
		seen := map[string]bool{}
		for _, q := range tries {
			if seen[q] || strings.TrimSpace(strings.Trim(q, ", ")) == city {
				continue
			}
			seen[q] = true
			if v, found, err := g.Lookup(ctx, q); err == nil && found {
				return v, true, true
			}
		}
	}
	if v, found, err := g.Lookup(ctx, city+", ישראל"); err == nil && found {
		return v, false, true
	}
	return
}

// Km is the great-circle distance between two points.
func Km(lat1, lon1, lat2, lon2 float64) float64 {
	r := math.Pi / 180
	p1, p2 := lat1*r, lat2*r
	dp, dl := p2-p1, (lon2-lon1)*r
	return 2 * 6371 * math.Asin(math.Sqrt(math.Sin(dp/2)*math.Sin(dp/2)+math.Cos(p1)*math.Cos(p2)*math.Sin(dl/2)*math.Sin(dl/2)))
}
