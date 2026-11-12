package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// StoreRef is a branch the user wants compared.
type StoreRef struct {
	Chain     string   `json:"chain"`    // portal key: shufersal, carrefour, RamiLevi, osherad, ...
	StoreID   string   `json:"store_id"` // as in the chain's Stores file
	ChainName string   `json:"chain_name"`
	Branch    string   `json:"branch"`
	Address   string   `json:"address"`
	Lat       *float64 `json:"lat"`
	Lon       *float64 `json:"lon"`
	Approx    bool     `json:"approx"` // coordinates are a city-centre fallback
}

type Config struct {
	Stores    []StoreRef `json:"stores"`
	Areas     []Area     `json:"areas"`
	MinStores int        `json:"min_stores"`
}

// Event reports sync progress. Phase: "check", "download", "cached", "parse", "skip", "build", "done".
type Event struct {
	Phase   string `json:"phase"`
	Store   string `json:"store,omitempty"`
	File    string `json:"file,omitempty"`
	Bytes   int64  `json:"bytes,omitempty"`
	Items   int    `json:"items,omitempty"`
	Message string `json:"message,omitempty"`
	Millis  int64  `json:"ms,omitempty"`
}

type Syncer struct {
	DataDir string       // raw/ holds downloaded files, catalog.json is written here
	Client  *http.Client // nil = default with a 5 minute timeout
	OnEvent func(Event)  // optional; may be called from several goroutines
	mu      sync.Mutex
}

func (s *Syncer) emit(e Event) {
	if s.OnEvent != nil {
		s.mu.Lock()
		s.OnEvent(e)
		s.mu.Unlock()
	}
}

// Sync checks every store's portal for its newest PriceFull file, downloads only files it doesn't
// already have, parses them in parallel and writes catalog.json. A store that fails is skipped and
// listed in Catalog.Skipped; Sync only errors if no store at all could be loaded.
func (s *Syncer) Sync(ctx context.Context, cfg Config) (*Catalog, error) {
	start := time.Now()
	raw := filepath.Join(s.DataDir, "raw")
	if err := os.MkdirAll(raw, 0o755); err != nil {
		return nil, err
	}
	if cfg.MinStores <= 0 {
		cfg.MinStores = 3
	}

	results := make([]result, len(cfg.Stores))

	// One goroutine per chain: chains in parallel, a chain's own stores in sequence over one login session.
	byChain := map[string][]int{}
	for i, st := range cfg.Stores {
		byChain[st.Chain] = append(byChain[st.Chain], i)
	}
	var wg sync.WaitGroup
	for chain, idxs := range byChain {
		wg.Add(1)
		go func(chain string, idxs []int) {
			defer wg.Done()
			portal, err := NewPortal(chain, s.Client)
			for _, i := range idxs {
				if err != nil {
					results[i].err = err
					continue
				}
				results[i].path, results[i].file, results[i].err = s.fetch(ctx, portal, cfg.Stores[i], raw)
			}
		}(chain, idxs)
	}
	wg.Wait()

	// Nothing new since the last catalog? Then the answer is the catalog we already have.
	if prev, err := LoadCatalog(s.DataDir); err == nil && unchanged(prev, cfg, results) {
		s.emit(Event{Phase: "done", Message: "unchanged", Items: len(prev.Products), Millis: time.Since(start).Milliseconds()})
		return prev, nil
	}

	// Parse in parallel.
	data := make([]*StoreData, len(cfg.Stores))
	var skipped []string
	var pwg sync.WaitGroup
	var smu sync.Mutex
	for i, r := range results {
		st := cfg.Stores[i]
		label := st.ChainName + " " + st.Branch
		if r.err != nil {
			skipped = append(skipped, fmt.Sprintf("%s: %v", label, r.err))
			s.emit(Event{Phase: "skip", Store: st.key(), Message: r.err.Error()})
			continue
		}
		pwg.Add(1)
		go func(i int, r result) {
			defer pwg.Done()
			t := time.Now()
			f, err := os.Open(r.path)
			if err == nil {
				var items []Item
				items, err = ParsePriceFile(f)
				f.Close()
				if err == nil {
					data[i] = &StoreData{Store: st.toStore(r.file), Items: items}
					s.emit(Event{Phase: "parse", Store: st.key(), Items: len(items), Millis: time.Since(t).Milliseconds()})
					return
				}
			}
			smu.Lock()
			skipped = append(skipped, fmt.Sprintf("%s: %v", label, err))
			smu.Unlock()
			os.Remove(r.path) // a corrupt download shouldn't be reused
		}(i, r)
	}
	pwg.Wait()

	var stores []StoreData
	var keys []string
	for i, d := range data {
		if d != nil {
			stores = append(stores, *d)
			keys = append(keys, cfg.Stores[i].Chain)
		}
	}
	if len(stores) == 0 {
		return nil, errors.New("no store could be loaded: " + strings.Join(skipped, "; "))
	}

	t := time.Now()
	products := BuildCatalog(stores, min(cfg.MinStores, len(stores)), keys)
	cat := &Catalog{
		PriceDate:   priceDate(stores),
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Skipped:     skipped,
		Areas:       cfg.Areas,
		Categories:  UsedCategories(products),
		Products:    products,
		Images:      ImageSources,
	}
	if cat.Skipped == nil {
		cat.Skipped = []string{}
	}
	for _, sd := range stores {
		cat.Stores = append(cat.Stores, sd.Store)
	}
	s.emit(Event{Phase: "build", Items: len(products), Millis: time.Since(t).Milliseconds()})

	if err := writeJSON(filepath.Join(s.DataDir, "catalog.json"), cat); err != nil {
		return nil, err
	}
	s.emit(Event{Phase: "done", Items: len(products), Millis: time.Since(start).Milliseconds()})
	return cat, nil
}

// fetch returns the local path of the store's newest PriceFull, downloading it only if it's new.
func (s *Syncer) fetch(ctx context.Context, p Portal, st StoreRef, raw string) (string, string, error) {
	s.emit(Event{Phase: "check", Store: st.key()})
	f, err := p.LatestPriceFull(ctx, st.StoreID)
	if err != nil {
		return "", "", err
	}
	name := safeName(f.Name)
	if !strings.HasSuffix(name, ".gz") && !strings.HasSuffix(name, ".xml") {
		name += ".gz"
	}
	dst := filepath.Join(raw, st.Chain+"_"+name)
	if _, err := os.Stat(dst); err == nil {
		s.emit(Event{Phase: "cached", Store: st.key(), File: f.Name})
		return dst, f.Name, nil
	}
	t := time.Now()
	rc, err := p.Open(ctx, f)
	if err != nil {
		return "", "", err
	}
	defer rc.Close()
	tmp := dst + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return "", "", err
	}
	n, err := io.Copy(out, rc)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return "", "", err
	}
	if err := os.Rename(tmp, dst); err != nil {
		return "", "", err
	}
	s.emit(Event{Phase: "download", Store: st.key(), File: f.Name, Bytes: n, Millis: time.Since(t).Milliseconds()})
	pruneOld(raw, st.Chain+"_", storeTag(st.StoreID), dst)
	return dst, f.Name, nil
}

// pruneOld deletes this store's older downloads so the phone doesn't fill up.
func pruneOld(dir, prefix, tag, keep string) {
	ents, _ := os.ReadDir(dir)
	for _, e := range ents {
		p := filepath.Join(dir, e.Name())
		if p != keep && strings.HasPrefix(e.Name(), prefix) && strings.Contains(e.Name(), tag) && strings.Contains(e.Name(), "PriceFull") {
			os.Remove(p)
		}
	}
}

func safeName(n string) string {
	return strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == ':' || r == '?' || r == '&' {
			return '_'
		}
		return r
	}, n)
}

func (st StoreRef) key() string { return st.Chain + ":" + st.StoreID }

// unchanged reports whether every store resolved to the same file the previous catalog was built from.
type result struct {
	path, file string
	err        error
}

func unchanged(prev *Catalog, cfg Config, results []result) bool {
	if len(prev.Stores) != len(cfg.Stores) || len(prev.Areas) != len(cfg.Areas) {
		return false
	}
	for i, r := range results {
		if r.err != nil || prev.Stores[i].ID != cfg.Stores[i].key() || prev.Stores[i].File != r.file {
			return false
		}
	}
	return true
}

func (st StoreRef) toStore(file string) Store {
	return Store{ID: st.key(), Chain: st.ChainName, Branch: st.Branch, Address: st.Address, Lat: st.Lat, Lon: st.Lon,
		Approx: st.Approx, File: file, FileTime: fileStamp(file)}
}

// priceDate is the newest file's date, as YYYY-MM-DD.
func priceDate(stores []StoreData) string {
	best := ""
	for _, s := range stores {
		if len(s.Store.FileTime) >= 8 && s.Store.FileTime > best {
			best = s.Store.FileTime
		}
	}
	if best == "" {
		return time.Now().Format("2006-01-02")
	}
	return best[:4] + "-" + best[4:6] + "-" + best[6:8]
}

func writeJSON(path string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	tmp := path + ".part"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// LoadCatalog reads the last catalog.json written by Sync.
func LoadCatalog(dataDir string) (*Catalog, error) {
	b, err := os.ReadFile(filepath.Join(dataDir, "catalog.json"))
	if err != nil {
		return nil, err
	}
	var c Catalog
	return &c, json.Unmarshal(b, &c)
}
