package core

import (
	"bytes"
	"context"
	_ "embed"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core/osmindex"
)

// The offline address index (see osmindex/README.md), built from an OpenStreetMap extract of
// Israel with `salzol osmindex build` and compiled in. It places 840 of the directory's 1,163
// branch addresses at street level or better, against 731 for the online geocoders, with no
// network and no rate limit. Data © OpenStreetMap contributors, ODbL.
//
//go:embed geoindex.bin.gz
var embeddedGeoIndex []byte

var (
	offlineOnce sync.Once
	offlineIdx  *osmindex.Index
)

// OfflineIndex returns the compiled-in index, loading it on first use; nil if it can't be read.
func OfflineIndex() *osmindex.Index {
	offlineOnce.Do(func() {
		if ix, err := osmindex.Load(bytes.NewReader(embeddedGeoIndex)); err == nil {
			offlineIdx = ix
		}
	})
	return offlineIdx
}

// offlinePlace looks an address up in the offline index; ok only for a street-level or better
// answer (a city-level answer is left to the online services, which may know the street).
func offlinePlace(address, city string) (ll [2]float64, ok bool) {
	ix := OfflineIndex()
	if ix == nil || strings.TrimSpace(address) == "" || strings.TrimSpace(city) == "" {
		return ll, false
	}
	r, found := ix.LookupDetail(address, city)
	if !found {
		return ll, false
	}
	switch r.Precision {
	case osmindex.PrecHouse, osmindex.PrecStreet, osmindex.PrecPOI:
		return [2]float64{r.Lat, r.Lon}, true
	}
	return ll, false
}

// LookupAddress geocodes an address a person typed ("הרצל 10, חיפה"): the offline index first
// when a city is given, then the online services (Lookup).
func (g *Geocoder) LookupAddress(ctx context.Context, q string) ([2]float64, bool, error) {
	q = strings.Join(strings.Fields(q), " ")
	if i := strings.LastIndexAny(q, ",،"); i > 0 {
		_, size := utf8.DecodeRuneInString(q[i:]) // "," is 1 byte, the Arabic comma 2
		if ll, ok := offlinePlace(q[:i], strings.TrimSpace(q[i+size:])); ok {
			return ll, true, nil
		}
	}
	return g.Lookup(ctx, q)
}
