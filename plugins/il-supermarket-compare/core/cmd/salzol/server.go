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
	defID := jobID(defCfg)
	if _, err := os.Stat(filepath.Join(data, sv.catalogFile(defID))); err != nil {
		sv.start(defCfg)
	}
	log.Printf("store directory: %d branches", len(dir.Stores))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"ok": true, "sync": true, "location": len(dir.Stores) > 0, "defaultJob": defID})
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
