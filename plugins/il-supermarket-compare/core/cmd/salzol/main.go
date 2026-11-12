// Command salzol syncs supermarket price files and serves the web app.
//
//	salzol sync  [-data DIR] [-config stores.json]          download what's new, write DIR/catalog.json
//	salzol serve [-data DIR] [-config stores.json] [-web DIR] [-addr :8080]
//	salzol stores CHAIN                                       list a chain's branches (to build a config)
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"time"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: salzol sync|serve|stores ...")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	switch os.Args[1] {
	case "sync":
		fs := flag.NewFlagSet("sync", flag.ExitOnError)
		data := fs.String("data", "salzol-data", "data directory")
		cfgPath := fs.String("config", "", "stores config JSON (default: built-in Ramat Gan area)")
		fs.Parse(os.Args[2:])
		cfg := loadConfig(*cfgPath)
		s := &core.Syncer{DataDir: *data, OnEvent: logEvent}
		cat, err := s.Sync(ctx, cfg)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Printf("%d products from %d stores -> %s\n", len(cat.Products), len(cat.Stores), filepath.Join(*data, "catalog.json"))
		for _, sk := range cat.Skipped {
			fmt.Println("skipped:", sk)
		}
	case "serve":
		fs := flag.NewFlagSet("serve", flag.ExitOnError)
		data := fs.String("data", "salzol-data", "data directory")
		cfgPath := fs.String("config", "", "stores config JSON")
		web := fs.String("web", "", "directory with the web app's index.html")
		addr := fs.String("addr", ":8080", "listen address")
		fs.Parse(os.Args[2:])
		serve(ctx, *addr, *data, *web, loadConfig(*cfgPath))
	case "stores":
		if len(os.Args) < 3 {
			log.Fatal("usage: salzol stores CHAIN (shufersal, carrefour, RamiLevi, osherad, yohananof, ...)")
		}
		p, err := core.NewPortal(os.Args[2], nil)
		if err != nil {
			log.Fatal(err)
		}
		rows, err := p.Stores(ctx)
		if err != nil {
			log.Fatal(err)
		}
		for _, r := range rows {
			fmt.Printf("%s:%s\t%s\t%s, %s\n", r.Chain, r.StoreID, r.Name, r.Address, r.City)
		}
	default:
		log.Fatalf("unknown command %q", os.Args[1])
	}
}

func loadConfig(path string) core.Config {
	if path == "" {
		return core.DefaultConfig()
	}
	b, err := os.ReadFile(path)
	if err != nil {
		log.Fatal(err)
	}
	var c core.Config
	if err := json.Unmarshal(b, &c); err != nil {
		log.Fatalf("%s: %v", path, err)
	}
	return c
}

func logEvent(e core.Event) {
	switch e.Phase {
	case "download":
		log.Printf("download %-14s %6d KB in %4d ms  %s", e.Store, e.Bytes/1024, e.Millis, e.File)
	case "cached":
		log.Printf("up to date %-12s %s", e.Store, e.File)
	case "parse":
		log.Printf("parse    %-14s %6d items in %4d ms", e.Store, e.Items, e.Millis)
	case "skip":
		log.Printf("skip     %-14s %s", e.Store, e.Message)
	case "build":
		log.Printf("matched  %d products in %d ms", e.Items, e.Millis)
	case "done":
		log.Printf("done in %d ms", e.Millis)
	}
}

// ---------------- server ----------------

type syncState struct {
	mu      sync.Mutex
	Running bool         `json:"running"`
	Started time.Time    `json:"started,omitempty"`
	Events  []core.Event `json:"events"`
	Error   string       `json:"error,omitempty"`
	Updated string       `json:"updated,omitempty"` // catalog generatedAt
}

func serve(ctx context.Context, addr, data, web string, cfg core.Config) {
	st := &syncState{Events: []core.Event{}}
	if c, err := core.LoadCatalog(data); err == nil {
		st.Updated = c.GeneratedAt
	}
	startSync := func() bool {
		st.mu.Lock()
		defer st.mu.Unlock()
		if st.Running {
			return false
		}
		st.Running, st.Started, st.Events, st.Error = true, time.Now(), []core.Event{}, ""
		go func() {
			s := &core.Syncer{DataDir: data, OnEvent: func(e core.Event) {
				logEvent(e)
				st.mu.Lock()
				st.Events = append(st.Events, e)
				st.mu.Unlock()
			}}
			c, err := s.Sync(context.Background(), cfg)
			st.mu.Lock()
			st.Running = false
			if err != nil {
				st.Error = err.Error()
			} else {
				st.Updated = c.GeneratedAt
			}
			st.mu.Unlock()
		}()
		return true
	}
	if _, err := os.Stat(filepath.Join(data, "catalog.json")); err != nil {
		startSync() // first run: build a catalog right away
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"ok": true, "sync": true})
	})
	mux.HandleFunc("GET /api/sync", func(w http.ResponseWriter, r *http.Request) {
		st.mu.Lock()
		defer st.mu.Unlock()
		writeJSON(w, st)
	})
	mux.HandleFunc("POST /api/sync", func(w http.ResponseWriter, r *http.Request) {
		started := startSync()
		w.WriteHeader(http.StatusAccepted)
		writeJSON(w, map[string]bool{"started": started})
	})
	mux.HandleFunc("GET /data.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(data, "catalog.json"))
	})
	mux.HandleFunc("GET /img/{code}", func(w http.ResponseWriter, r *http.Request) {
		serveImage(w, r, data, r.PathValue("code"))
	})
	if web != "" {
		mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) { serveIndex(w, filepath.Join(web, "index.html")) })
		mux.Handle("GET /", http.FileServer(http.Dir(web)))
	}

	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { <-ctx.Done(); srv.Shutdown(context.Background()) }()
	log.Printf("serving on %s (data %s)", addr, data)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
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

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
