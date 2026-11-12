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
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"

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
		dirPath := fs.String("directory", "", "store directory JSON (default: the one built into this binary)")
		fs.Parse(os.Args[2:])
		serve(ctx, *addr, *data, *web, loadConfig(*cfgPath), loadDirectory(*dirPath))
	case "directory":
		fs := flag.NewFlagSet("directory", flag.ExitOnError)
		out := fs.String("out", "directory.json", "output file")
		geoCache := fs.String("geocache", "salzol-data/geocode.json", "geocode cache")
		fs.Parse(os.Args[2:])
		chains := append(append([]string{"shufersal", "carrefour"}, sortedKeys(core.PublishedPricesUsers)...), core.ExtraChains...)
		if only := fs.Arg(0); only != "" { // salzol directory -out x.json wolt,bareket: just these chains
			chains = strings.Split(only, ",")
		}
		geo := core.NewGeocoder(*geoCache)
		d, err := core.BuildDirectory(ctx, chains, geo, nil, func(e core.Event) {
			log.Printf("%-8s %-12s %d %s", e.Phase, e.Store, e.Items, e.Message)
		})
		if err != nil {
			log.Fatal(err)
		}
		b, _ := json.Marshal(d)
		if err := os.WriteFile(*out, b, 0o644); err != nil {
			log.Fatal(err)
		}
		exact, approx, none := 0, 0, 0
		for _, s := range d.Stores {
			switch {
			case s.Lat == 0:
				none++
			case s.Approx:
				approx++
			default:
				exact++
			}
		}
		fmt.Printf("%d stores -> %s (%d at street level, %d at city centre, %d unlocated)\n", len(d.Stores), *out, exact, approx, none)
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

func sortedKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
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

func loadDirectory(path string) *core.Directory {
	if path == "" {
		d, err := core.DefaultDirectory()
		if err != nil {
			log.Fatal(err)
		}
		return d
	}
	b, err := os.ReadFile(path)
	if err != nil {
		log.Fatal(err)
	}
	var d core.Directory
	if err := json.Unmarshal(b, &d); err != nil {
		log.Fatalf("%s: %v", path, err)
	}
	return &d
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

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
