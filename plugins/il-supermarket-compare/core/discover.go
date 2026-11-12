package core

// On-device store discovery. The embedded directory.json was built on a cloud machine outside
// Israel, so chains whose portals refuse foreign IPs (Victory, Carrefour/Yayno Bitan, Hazi Hinam,
// Mahsanei HaShuk, H. Cohen, Quik) are missing from it. A phone in Israel can reach them, so it
// downloads those chains' Stores files itself, places each branch (offline index first), and keeps
// the result in <dataDir>/directory-extra.json, merged with the embedded directory at load time.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	// ExtraFile is the discovered-stores file inside the data directory.
	ExtraFile = "directory-extra.json"
	// ExtraMaxAge is how long discovered stores are trusted before the chains are asked again.
	ExtraMaxAge = 7 * 24 * time.Hour
	// retryAfter keeps a chain that fails (or has no stores) from being retried on every launch.
	retryAfter = 6 * time.Hour
	// discoverOnlineBudget caps the branches sent to the rate-limited online geocoders (about one
	// request a second each); the rest are placed by the offline index or at their city's centre.
	discoverOnlineBudget = 40
)

// notGroceryChains are portal keys that are not supermarkets (pharmacies) and are never discovered.
var notGroceryChains = map[string]bool{"superpharm": true, "goodpharm": true, "newpharm": true, "be": true}

// extraFile is directory-extra.json: the discovered branches plus when each chain was last tried.
type extraFile struct {
	Built  string            `json:"built"`
	Stores []DirStore        `json:"stores"`
	Tried  map[string]string `json:"tried,omitempty"` // chain -> RFC3339 time of the last attempt
}

func loadExtra(dataDir string) *extraFile {
	e := &extraFile{}
	if b, err := os.ReadFile(filepath.Join(dataDir, ExtraFile)); err == nil {
		if json.Unmarshal(b, e) != nil {
			e = &extraFile{} // a damaged file is treated as missing
		}
	}
	return e
}

// mergeDirectories returns base plus extra; extra wins on the same chain:store key.
func mergeDirectories(base *Directory, extra []DirStore) *Directory {
	out := &Directory{Built: base.Built, Stores: make([]DirStore, 0, len(base.Stores)+len(extra))}
	over := make(map[string]bool, len(extra))
	for _, s := range extra {
		over[s.Key()] = true
	}
	for _, s := range base.Stores {
		if !over[s.Key()] {
			out.Stores = append(out.Stores, s)
		}
	}
	out.Stores = append(out.Stores, extra...)
	return out
}

// LoadDirectory returns the embedded directory merged with the stores discovered on this device
// (dataDir/directory-extra.json), which win on the same chain:store key. A missing or damaged
// extra file just means the embedded directory alone.
func LoadDirectory(dataDir string) (*Directory, error) {
	base, err := DefaultDirectory()
	if err != nil {
		return nil, err
	}
	if dataDir == "" {
		return base, nil
	}
	return mergeDirectories(base, loadExtra(dataDir).Stores), nil
}

// DiscoverableChains are the chains worth discovering: in ChainNames, with no branch in the
// embedded directory, and not a pharmacy. Computed, so rebuilding the directory shrinks the list.
func DiscoverableChains() []string {
	base, err := DefaultDirectory()
	if err != nil {
		return nil
	}
	have := map[string]bool{}
	for _, s := range base.Stores {
		have[s.Chain] = true
	}
	var out []string
	for c := range ChainNames {
		if !have[c] && !notGroceryChains[strings.ToLower(c)] {
			out = append(out, c)
		}
	}
	sort.Strings(out)
	return out
}

// chainsDue applies the refresh policy to the discoverable chains: a chain is due when the merged
// directory has no branch of it, or the extra file is older than ExtraMaxAge; and it was not
// already tried within retryAfter (so an unreachable portal isn't hit on every launch).
func chainsDue(candidates []string, merged *Directory, e *extraFile, now time.Time) []string {
	have := map[string]bool{}
	for _, s := range merged.Stores {
		have[s.Chain] = true
	}
	built, _ := time.Parse(time.RFC3339, e.Built)
	stale := built.IsZero() || now.Sub(built) > ExtraMaxAge
	var out []string
	for _, c := range candidates {
		if have[c] && !stale {
			continue
		}
		if t, err := time.Parse(time.RFC3339, e.Tried[c]); err == nil && now.Sub(t) < retryAfter {
			continue
		}
		out = append(out, c)
	}
	return out
}

// ChainsToDiscover lists the chains that need discovery now (see chainsDue). Empty means nothing
// to do, so the app can skip the call.
func ChainsToDiscover(dataDir string, now time.Time) []string {
	base, err := DefaultDirectory()
	if err != nil {
		return nil
	}
	e := loadExtra(dataDir)
	return chainsDue(DiscoverableChains(), mergeDirectories(base, e.Stores), e, now)
}

// DiscoverStores downloads the given chains' Stores files and locates each branch, like
// BuildDirectory, but sized for a phone: addresses go to the offline index first, at most
// discoverOnlineBudget go to the online geocoders, and the rest are placed at their city's centre
// (marked approx). Chains that fail are reported through onEvent and left out; it errors only when
// the context ends or every chain failed.
func DiscoverStores(ctx context.Context, chains []string, geo *Geocoder, client *http.Client, onEvent func(Event)) (*Directory, error) {
	d, errs, err := buildDirectory(ctx, chains, geo, client, onEvent, discoverOnlineBudget)
	if err != nil {
		return nil, err
	}
	if len(chains) > 0 && len(errs) == len(chains) {
		return d, joinChainErrors(errs)
	}
	return d, nil
}

func joinChainErrors(errs map[string]error) error {
	keys := make([]string, 0, len(errs))
	for k := range errs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var all []error
	for _, k := range keys {
		all = append(all, fmt.Errorf("%s: %w", k, errs[k]))
	}
	return errors.Join(all...)
}

// DiscoverySummary is what RefreshExtra reports.
type DiscoverySummary struct {
	Counts  map[string]int    `json:"counts"`            // chain -> branches found
	Errors  map[string]string `json:"errors"`            // chain -> why it failed
	Names   map[string]string `json:"names,omitempty"`   // chain -> Hebrew name, for display
	Skipped bool              `json:"skipped,omitempty"` // nothing was due
}

// RefreshExtra discovers the chains that are due (see ChainsToDiscover), merges the result into
// <dataDir>/directory-extra.json and returns a summary. Chains that fail keep whatever was stored
// for them before. It sends a "discover" event first, naming the chains, then the build's own
// events.
func RefreshExtra(ctx context.Context, dataDir string, geo *Geocoder, client *http.Client, onEvent func(Event), now time.Time) (DiscoverySummary, error) {
	sum := DiscoverySummary{Counts: map[string]int{}, Errors: map[string]string{}, Names: map[string]string{}}
	chains := ChainsToDiscover(dataDir, now)
	if len(chains) == 0 {
		sum.Skipped = true
		return sum, nil
	}
	var names []string
	for _, c := range chains {
		sum.Names[c] = ChainNames[c]
		names = append(names, ChainNames[c])
	}
	if onEvent != nil {
		onEvent(Event{Phase: "discover", Items: len(chains), Message: strings.Join(names, ", ")})
	}
	d, errs, err := buildDirectory(ctx, chains, geo, client, onEvent, discoverOnlineBudget)
	if err != nil {
		return sum, err
	}

	e := loadExtra(dataDir)
	if e.Tried == nil {
		e.Tried = map[string]string{}
	}
	stamp := now.UTC().Format(time.RFC3339)
	found := map[string][]DirStore{}
	for _, s := range d.Stores {
		found[s.Chain] = append(found[s.Chain], s)
	}
	drop := map[string]bool{}
	for _, c := range chains {
		e.Tried[c] = stamp
		if er, failed := errs[c]; failed {
			sum.Errors[c] = er.Error()
			continue
		}
		sum.Counts[c] = len(found[c])
		if len(found[c]) > 0 { // an empty answer doesn't erase branches found earlier
			drop[c] = true
		}
	}
	kept := e.Stores[:0:0]
	for _, s := range e.Stores {
		if !drop[s.Chain] {
			kept = append(kept, s)
		}
	}
	for c := range drop {
		kept = append(kept, found[c]...)
	}
	sort.Slice(kept, func(i, j int) bool { return kept[i].Key() < kept[j].Key() })
	e.Stores = kept
	if len(drop) > 0 {
		e.Built = stamp
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return sum, err
	}
	if err := writeJSON(filepath.Join(dataDir, ExtraFile), e); err != nil {
		return sum, err
	}
	return sum, nil
}
