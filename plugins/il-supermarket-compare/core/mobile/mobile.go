// Package mobile is the surface the phone apps call, built with gomobile:
//
//	gomobile bind -target=android -o salzol.aar ./mobile     (Android, needs the NDK)
//	gomobile bind -target=ios -o Salzol.xcframework ./mobile (iOS, needs Xcode on a Mac)
//
// gomobile only passes strings, numbers, []byte, errors and interfaces, so config and results are JSON.
package mobile

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
)

// Listener receives sync progress as JSON-encoded core.Event values.
type Listener interface {
	OnEvent(eventJSON string)
}

var (
	mu     sync.Mutex
	cancel context.CancelFunc
)

// DefaultConfig returns the built-in stores config as JSON.
func DefaultConfig() string {
	b, _ := json.Marshal(core.DefaultConfig())
	return string(b)
}

// Sync downloads whatever is new, rebuilds the catalog and returns the path of catalog.json.
// configJSON may be empty for the default config. Only one sync runs at a time; a second call
// cancels the first.
func Sync(dataDir, configJSON string, l Listener) (string, error) {
	cfg := core.DefaultConfig()
	if configJSON != "" {
		if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
			return "", err
		}
	}
	mu.Lock()
	if cancel != nil {
		cancel()
	}
	ctx, c := context.WithTimeout(context.Background(), 10*time.Minute)
	cancel = c
	mu.Unlock()
	defer c()

	s := &core.Syncer{DataDir: dataDir}
	if l != nil {
		s.OnEvent = func(e core.Event) {
			b, _ := json.Marshal(e)
			l.OnEvent(string(b))
		}
	}
	if _, err := s.Sync(ctx, cfg); err != nil {
		return "", err
	}
	return dataDir + "/catalog.json", nil
}

// CancelSync stops a running sync.
func CancelSync() {
	mu.Lock()
	defer mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

var imgClient = &http.Client{Timeout: 20 * time.Second}

// ResolveImage returns a photo URL for a barcode, or "" if none is known (cached under dataDir).
func ResolveImage(dataDir, code string) string {
	u, _ := core.ResolveImage(context.Background(), imgClient, dataDir, code)
	return u
}

// Geocode looks an address up (cached under dataDir) and returns {"found":bool,"lat":..,"lon":..}.
func Geocode(dataDir, query string) string {
	g := core.NewGeocoder(dataDir + "/geocode.json")
	ll, ok, err := g.LookupAddress(context.Background(), query)
	g.Save()
	if err != nil {
		b, _ := json.Marshal(map[string]any{"found": false, "error": err.Error()})
		return string(b)
	}
	b, _ := json.Marshal(map[string]any{"found": ok, "lat": ll[0], "lon": ll[1]})
	return string(b)
}

// NearbyStores returns the stores worth comparing around a point, as JSON, from the store
// directory built into the library plus the chains discovered on this device (see DiscoverStores).
// max <= 0 means 14.
func NearbyStores(dataDir string, lat, lon, radiusKm float64, max int) (string, error) {
	d, err := core.LoadDirectory(dataDir)
	if err != nil {
		return "", err
	}
	if max <= 0 {
		max = 14
	}
	b, err := json.Marshal(d.Nearby(lat, lon, radiusKm, max))
	return string(b), err
}

// SyncNear syncs the stores around a point (GPS or a geocoded address) and returns catalog.json's path.
// NearbyMax is how many branches a location compares: every chain around first, then more
// branches of the discount chains. A cached sync of 18 takes a few seconds on a phone.
const NearbyMax = 18

func SyncNear(dataDir, place string, lat, lon, radiusKm float64, l Listener) (string, error) {
	d, err := core.LoadDirectory(dataDir)
	if err != nil {
		return "", err
	}
	near := d.Nearby(lat, lon, radiusKm, NearbyMax)
	if len(near) == 0 {
		return "", errNoStores
	}
	b, _ := json.Marshal(core.ConfigFor(near, place, lat, lon))
	return Sync(dataDir, string(b), l)
}

var discoverMu sync.Mutex

// DiscoverStores adds the stores of chains whose price portals the embedded directory lacks
// (they refuse non-Israeli IPs, so they can only be fetched from a phone in Israel) to
// dataDir/directory-extra.json. It does nothing, quickly and offline, when nothing is due: every
// such chain has stores and the file is under 7 days old. Progress arrives on the listener as
// core.Event JSON ("discover" first, then "stores", "geocode", "skip"). The result is JSON:
// {"counts":{"victory":52},"errors":{"hazihinam":"..."},"names":{"victory":"ויקטורי"},"skipped":false}.
// A chain that fails is reported in "errors"; only a cancelled or timed-out run returns an error.
func DiscoverStores(dataDir string, l Listener) (string, error) {
	discoverMu.Lock()
	defer discoverMu.Unlock()
	ctx, c := context.WithTimeout(context.Background(), 5*time.Minute)
	defer c()
	var on func(core.Event)
	if l != nil {
		on = func(e core.Event) {
			b, _ := json.Marshal(e)
			l.OnEvent(string(b))
		}
	}
	geo := core.NewGeocoder(dataDir + "/geocode.json")
	sum, err := core.RefreshExtra(ctx, dataDir, geo, &http.Client{Timeout: 90 * time.Second}, on, time.Now())
	geo.Save()
	b, _ := json.Marshal(sum)
	return string(b), err
}

var errNoStores = errorString("no known stores within this radius")

type errorString string

func (e errorString) Error() string { return string(e) }

// CityCentre returns {"found":bool,"lat":..,"lon":..}: the centre of a city estimated from the
// store directory (embedded plus discovered), with no network. The app uses it to check its own
// geocoder's answers.
func CityCentre(dataDir, city string) string {
	d, err := core.LoadDirectory(dataDir)
	if err != nil {
		return `{"found":false}`
	}
	lat, lon, ok := d.CityCentre(city)
	b, _ := json.Marshal(map[string]any{"found": ok, "lat": lat, "lon": lon})
	return string(b)
}
