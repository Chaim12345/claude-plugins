package main

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
)

// job is one sync for one set of stores. Jobs are keyed by their store set, so two people in the
// same neighbourhood share a catalog, and every job shares the raw download cache.
type job struct {
	mu      sync.Mutex
	ID      string       `json:"job"`
	Running bool         `json:"running"`
	Events  []core.Event `json:"events"`
	Error   string       `json:"error,omitempty"`
	Updated string       `json:"updated,omitempty"`
	Stores  int          `json:"stores"`
}

type server struct {
	data string
	dir  *core.Directory
	geo  *core.Geocoder
	api  *core.OpenAPI // nil without SALZOL_OSM_TOKEN
	mu   sync.Mutex
	jobs map[string]*job
}

func jobID(cfg core.Config) string {
	keys := make([]string, 0, len(cfg.Stores))
	for _, s := range cfg.Stores {
		keys = append(keys, s.Chain+":"+s.StoreID)
	}
	sort.Strings(keys)
	h := sha1.Sum([]byte(strings.Join(keys, ",")))
	return hex.EncodeToString(h[:6])
}

func (sv *server) catalogFile(id string) string { return "catalog-" + id + ".json" }

// start runs a sync for cfg unless one for the same store set is already running.
func (sv *server) start(cfg core.Config) *job {
	id := jobID(cfg)
	sv.mu.Lock()
	j := sv.jobs[id]
	if j == nil {
		j = &job{ID: id}
		sv.jobs[id] = j
	}
	sv.mu.Unlock()

	j.mu.Lock()
	defer j.mu.Unlock()
	if j.Running {
		return j
	}
	j.Running, j.Events, j.Error, j.Stores = true, []core.Event{}, "", len(cfg.Stores)
	go func() {
		s := &core.Syncer{DataDir: sv.data, Catalog: sv.catalogFile(id), OnEvent: func(e core.Event) {
			logEvent(e)
			j.mu.Lock()
			j.Events = append(j.Events, e)
			j.mu.Unlock()
		}}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		c, err := s.Sync(ctx, cfg)
		j.mu.Lock()
		j.Running = false
		if err != nil {
			j.Error = err.Error()
		} else {
			j.Updated = c.GeneratedAt
		}
		j.mu.Unlock()
	}()
	return j
}

func (sv *server) get(id string) *job {
	sv.mu.Lock()
	defer sv.mu.Unlock()
	return sv.jobs[id]
}

func serve(ctx context.Context, addr, data, web string, defCfg core.Config, dir *core.Directory) {
	sv := &server{data: data, dir: dir, geo: core.NewGeocoder(filepath.Join(data, "geocode.json")), jobs: map[string]*job{}}
	if tok := apiToken(); tok != "" {
		sv.api = core.NewOpenAPI(tok)
		log.Printf("Open Israeli Supermarkets API: enabled")
	}
	defID := jobID(defCfg)
	if _, err := os.Stat(filepath.Join(data, sv.catalogFile(defID))); err != nil {
		sv.start(defCfg)
	}
	log.Printf("store directory: %d branches", len(dir.Stores))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"ok": true, "sync": true, "location": len(dir.Stores) > 0, "defaultJob": defID, "more": sv.api != nil})
	})

	// GET /api/geocode?q=הרצל 50, רמת גן
	mux.HandleFunc("GET /api/geocode", func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" || len(q) > 200 {
			http.Error(w, "q is required", 400)
			return
		}
		ll, ok, err := sv.geo.Lookup(r.Context(), q)
		if err != nil {
			http.Error(w, "geocoding service unavailable", 502)
			return
		}
		if !ok {
			writeJSON(w, map[string]any{"found": false})
			return
		}
		writeJSON(w, map[string]any{"found": true, "lat": ll[0], "lon": ll[1]})
	})

	// GET /api/nearby?lat=&lon=&radius=4&max=14
	mux.HandleFunc("GET /api/nearby", func(w http.ResponseWriter, r *http.Request) {
		lat, lon, radius, max, ok := pointArgs(r)
		if !ok {
			http.Error(w, "lat and lon are required", 400)
			return
		}
		writeJSON(w, map[string]any{"stores": dir.Nearby(lat, lon, radius, max)})
	})

	// POST /api/sync                       sync the default config
	// POST /api/sync?lat=&lon=&radius=&place=   sync the stores around a point
	mux.HandleFunc("POST /api/sync", func(w http.ResponseWriter, r *http.Request) {
		cfg := defCfg
		if lat, lon, radius, max, ok := pointArgs(r); ok {
			near := dir.Nearby(lat, lon, radius, max)
			if len(near) == 0 {
				w.WriteHeader(http.StatusUnprocessableEntity)
				writeJSON(w, map[string]any{"error": "no_stores", "message": "אין סניפים מוכרים בטווח הזה. נסו מרחק גדול יותר."})
				return
			}
			place := strings.TrimSpace(r.URL.Query().Get("place"))
			if place == "" {
				place = "המיקום שלי"
			}
			cfg = core.ConfigFor(near, place, lat, lon)
		}
		j := sv.start(cfg)
		w.WriteHeader(http.StatusAccepted)
		writeJSON(w, map[string]any{"job": j.ID, "stores": len(cfg.Stores)})
	})

	// GET /api/sync?job=ID  progress
	mux.HandleFunc("GET /api/sync", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("job")
		if id == "" {
			id = defID
		}
		j := sv.get(id)
		if j == nil {
			writeJSON(w, map[string]any{"job": id, "running": false, "events": []any{}})
			return
		}
		j.mu.Lock()
		defer j.mu.Unlock()
		writeJSON(w, j)
	})

	// GET /api/more?job=ID&lat=&lon=&radius=&codes=barcode,barcode
	// Nearby branches of chains the job's catalog doesn't cover, priced through the Open Israeli
	// Supermarkets API.
	mux.HandleFunc("GET /api/more", func(w http.ResponseWriter, r *http.Request) {
		if sv.api == nil {
			http.Error(w, "the Open Israeli Supermarkets API is not configured (SALZOL_OSM_TOKEN)", 404)
			return
		}
		lat, lon, radius, _, ok := pointArgs(r)
		if !ok {
			http.Error(w, "lat and lon are required", 400)
			return
		}
		var codes []string
		for _, c := range strings.Split(r.URL.Query().Get("codes"), ",") {
			if c = strings.TrimSpace(c); len(c) >= 7 && len(c) <= 14 && strings.Trim(c, "0123456789") == "" {
				codes = append(codes, c)
			}
		}
		if len(codes) == 0 || len(codes) > 60 {
			http.Error(w, "codes: 1 to 60 barcodes", 400)
			return
		}
		skip := map[string]bool{}
		if id := r.URL.Query().Get("job"); id != "" && !strings.ContainsAny(id, "/\\.") {
			if c, err := core.LoadCatalogFile(filepath.Join(data, sv.catalogFile(id))); err == nil {
				for _, s := range c.Stores {
					if code, ok := core.ChainCodes[strings.SplitN(s.ID, ":", 2)[0]]; ok {
						skip[code] = true
					}
				}
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		stores, err := core.NearbyExtra(ctx, sv.api, sv.geo, dir, codes, lat, lon, radius, skip)
		if err != nil {
			w.WriteHeader(http.StatusBadGateway)
			writeJSON(w, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, map[string]any{"stores": stores, "source": "Open Israeli Supermarkets", "sourceUrl": "https://github.com/OpenIsraeliSupermarkets"})
	})

	// GET /data.json?job=ID  the catalog (default job without ?job)
	mux.HandleFunc("GET /data.json", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("job")
		if id == "" {
			id = defID
		}
		if strings.ContainsAny(id, "/\\.") {
			http.Error(w, "bad job", 400)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(data, sv.catalogFile(id)))
	})
	mux.HandleFunc("GET /img/{code}", func(w http.ResponseWriter, r *http.Request) {
		serveImage(w, r, data, r.PathValue("code"))
	})
	if web != "" {
		mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) { serveIndex(w, filepath.Join(web, "index.html")) })
		mux.Handle("GET /", http.FileServer(http.Dir(web)))
	}

	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { <-ctx.Done(); sv.geo.Save(); srv.Shutdown(context.Background()) }()
	log.Printf("serving on %s (data %s)", addr, data)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// apiToken reads the Open Israeli Supermarkets token from SALZOL_OSM_TOKEN, or the file named by
// SALZOL_OSM_TOKEN_FILE (default ~/.config/salzol/osm-token). It is never logged.
func apiToken() string {
	if t := strings.TrimSpace(os.Getenv("SALZOL_OSM_TOKEN")); t != "" {
		return t
	}
	f := os.Getenv("SALZOL_OSM_TOKEN_FILE")
	if f == "" {
		if home, err := os.UserHomeDir(); err == nil {
			f = filepath.Join(home, ".config", "salzol", "osm-token")
		}
	}
	if b, err := os.ReadFile(f); err == nil {
		return strings.TrimSpace(string(b))
	}
	return ""
}

func pointArgs(r *http.Request) (lat, lon, radius float64, max int, ok bool) {
	q := r.URL.Query()
	lat, e1 := strconv.ParseFloat(q.Get("lat"), 64)
	lon, e2 := strconv.ParseFloat(q.Get("lon"), 64)
	if e1 != nil || e2 != nil || lat < 29 || lat > 34 || lon < 34 || lon > 36 { // Israel's bounding box
		return 0, 0, 0, 0, false
	}
	radius, err := strconv.ParseFloat(q.Get("radius"), 64)
	if err != nil || radius <= 0 || radius > 25 {
		radius = 4
	}
	max, err = strconv.Atoi(q.Get("max"))
	if err != nil || max <= 0 || max > 30 {
		max = 14
	}
	return lat, lon, radius, max, true
}

// serveIndex wraps the page in a document skeleton when it lacks one (the same file is published
// as a Claude artifact, where the host adds the skeleton).
func serveIndex(w http.ResponseWriter, path string) {
	b, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, "index.html not found", 404)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(string(b))), "<!doctype") {
		io.WriteString(w, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>`)
		w.Write(b)
		io.WriteString(w, "</body></html>")
		return
	}
	w.Write(b)
}

// serveImage proxies and caches product photos so browsers hit the source at most once per product.
var imgClient = &http.Client{Timeout: 20 * time.Second}

func serveImage(w http.ResponseWriter, r *http.Request, data, code string) {
	dir := filepath.Join(data, "img")
	file := filepath.Join(dir, filepath.Base(code)+".jpg")
	if _, err := os.Stat(file); err == nil {
		w.Header().Set("Cache-Control", "public, max-age=2592000")
		http.ServeFile(w, r, file)
		return
	}
	u, err := core.ResolveImage(r.Context(), imgClient, data, code)
	if err != nil || u == "" {
		w.Header().Set("Cache-Control", "public, max-age=86400")
		http.NotFound(w, r)
		return
	}
	req, _ := http.NewRequestWithContext(r.Context(), "GET", u, nil)
	req.Header.Set("User-Agent", "salzol/0.1 (personal grocery price comparison)")
	resp, err := imgClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		if resp != nil {
			resp.Body.Close()
		}
		http.NotFound(w, r)
		return
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		http.Error(w, "image fetch failed", 502)
		return
	}
	os.MkdirAll(dir, 0o755)
	os.WriteFile(file, b, 0o644)
	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.Header().Set("Cache-Control", "public, max-age=2592000")
	w.Write(b)
}
