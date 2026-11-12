package osmindex

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strings"
	"time"
)

// RunCLI implements `salzol osmindex build|eval`.
func RunCLI(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: salzol osmindex build -pbf X -out Y | eval -index Y -directory core/directory.json")
	}
	switch args[0] {
	case "build":
		fs := flag.NewFlagSet("osmindex build", flag.ExitOnError)
		pbf := fs.String("pbf", "", "OpenStreetMap .osm.pbf extract")
		out := fs.String("out", "osmindex.bin.gz", "output index file")
		fs.Parse(args[1:])
		if *pbf == "" {
			return fmt.Errorf("-pbf is required")
		}
		t0 := time.Now()
		ix, err := Build(*pbf)
		if err != nil {
			return err
		}
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)
		f, err := os.Create(*out)
		if err != nil {
			return err
		}
		bw := bufio.NewWriter(f)
		if err := ix.Write(bw); err != nil {
			f.Close()
			return err
		}
		if err := bw.Flush(); err != nil {
			f.Close()
			return err
		}
		if err := f.Close(); err != nil {
			return err
		}
		st, _ := os.Stat(*out)
		fmt.Printf("%s\nbuilt in %s (peak heap %d MB, total alloc %d MB); %s = %.2f MB\n",
			ix.Stats(), time.Since(t0).Round(time.Second), ms.HeapSys>>20, ms.TotalAlloc>>20, *out, float64(st.Size())/1e6)
		return nil
	case "eval":
		fs := flag.NewFlagSet("osmindex eval", flag.ExitOnError)
		path := fs.String("index", "osmindex.bin.gz", "index file")
		dir := fs.String("directory", "directory.json", "store directory JSON")
		verbose := fs.Bool("v", false, "list disagreements and more misses")
		fs.Parse(args[1:])
		f, err := os.Open(*path)
		if err != nil {
			return err
		}
		ix, err := Load(bufio.NewReader(f))
		f.Close()
		if err != nil {
			return err
		}
		b, err := os.ReadFile(*dir)
		if err != nil {
			return err
		}
		var d struct {
			Stores []EvalStore `json:"stores"`
		}
		if err := json.Unmarshal(b, &d); err != nil {
			return err
		}
		fmt.Print(Evaluate(ix, d.Stores, *verbose).String())
		return nil
	}
	return fmt.Errorf("unknown osmindex command %q", args[0])
}

// EvalStore is the subset of a directory entry the evaluation needs.
type EvalStore struct {
	Chain  string  `json:"c"`
	Banner string  `json:"b"`
	Name   string  `json:"n"`
	Addr   string  `json:"a"`
	City   string  `json:"city"`
	Lat    float64 `json:"lat"`
	Lon    float64 `json:"lon"`
	Approx bool    `json:"approx"`
}

// Report holds the metrics printed by `eval`.
type Report struct {
	Total, Online                    int
	House, Street, POI, City, Miss   int
	Branch                           int
	Agree, Compared                  int
	AgreeBy, ComparedBy              map[string]int
	BranchAgree, BranchCompared      int
	Misses, Disagree, BranchOnlyHits []string
	MissCats                         map[string]int
	verbose                          bool
}

// Evaluate geocodes every directory branch that has an address and a city and compares with
// the stored (online, street-level) coordinates.
func Evaluate(ix *Index, stores []EvalStore, verbose bool) *Report {
	r := &Report{AgreeBy: map[string]int{}, ComparedBy: map[string]int{}, MissCats: map[string]int{}, verbose: verbose}
	for _, s := range stores {
		if s.City == "" || s.Addr == "" {
			continue
		}
		r.Total++
		online := s.Lat != 0 && !s.Approx
		if online {
			r.Online++
		}
		res, ok := ix.LookupDetail(s.Addr, s.City)
		prec := res.Precision
		if !ok {
			prec = "none"
		}
		switch prec {
		case PrecHouse:
			r.House++
		case PrecStreet:
			r.Street++
		case PrecPOI:
			r.POI++
		case PrecCity:
			r.City++
		default:
			r.Miss++
		}
		if prec == PrecHouse || prec == PrecStreet || prec == PrecPOI {
			if online {
				r.Compared++
				r.ComparedBy[prec]++
				if kmBetween(res.Lat, res.Lon, s.Lat, s.Lon) < 1.0 {
					r.Agree++
					r.AgreeBy[prec]++
				} else if len(r.Disagree) < 25 {
					r.Disagree = append(r.Disagree, fmt.Sprintf("%s / %s -> %s %s (%.1f km off)", s.Addr, s.City, prec, res.Method, kmBetween(res.Lat, res.Lon, s.Lat, s.Lon)))
				}
			}
		} else {
			cat := missCategory(ix, s)
			r.MissCats[cat]++
			if len(r.Misses) < 400 {
				r.Misses = append(r.Misses, fmt.Sprintf("[%s] %s / %s", cat, s.Addr, s.City))
			}
		}
		if len(ix.Brands) > 0 {
			if br, ok := ix.LookupBranch(s.Banner, s.Name, s.City, s.Addr); ok {
				r.Branch++
				if online {
					r.BranchCompared++
					if kmBetween(br.Lat, br.Lon, s.Lat, s.Lon) < 1.0 {
						r.BranchAgree++
					}
				}
			}
		}
	}
	return r
}

func missCategory(ix *Index, s EvalStore) string {
	if len(ix.cityIDs(s.City)) == 0 {
		return "city unknown to index"
	}
	p := ParseAddress(s.Addr, s.City)
	switch {
	case len(p.Streets) == 0:
		return "no street in address text (url, number only, empty)"
	case p.Num == 0 && len(p.POIs) > 0:
		return "no house number (mall / area / landmark name)"
	}
	return "street not in index for that city"
}

func pct(a, b int) string {
	if b == 0 {
		return "n/a"
	}
	return fmt.Sprintf("%.1f%%", 100*float64(a)/float64(b))
}

func (r *Report) String() string {
	var b strings.Builder
	w := func(f string, a ...any) { fmt.Fprintf(&b, f, a...) }
	w("directory branches with address+city: %d\n", r.Total)
	w("  online geocoders, street level:        %d\n", r.Online)
	w("  offline index: house %d, street %d, poi %d, city-only %d, not found %d\n", r.House, r.Street, r.POI, r.City, r.Miss)
	w("  offline street-or-better (house+street+poi): %d\n", r.House+r.Street+r.POI)
	w("  within 1 km of the online street-level result: %d of %d compared (%s)\n", r.Agree, r.Compared, pct(r.Agree, r.Compared))
	for _, p := range []string{PrecHouse, PrecStreet, PrecPOI} {
		w("    %-6s %d of %d (%s)\n", p, r.AgreeBy[p], r.ComparedBy[p], pct(r.AgreeBy[p], r.ComparedBy[p]))
	}
	if r.Branch > 0 || r.BranchCompared > 0 {
		w("  branch POI (same brand, same city): matched %d, within 1 km of online %d of %d (%s)\n", r.Branch, r.BranchAgree, r.BranchCompared, pct(r.BranchAgree, r.BranchCompared))
	}
	cats := make([]string, 0, len(r.MissCats))
	for c := range r.MissCats {
		cats = append(cats, c)
	}
	sort.Strings(cats)
	w("  miss categories:\n")
	for _, c := range cats {
		w("    %4d %s\n", r.MissCats[c], c)
	}
	n := 12
	if r.verbose {
		n = len(r.Misses)
	}
	if n > len(r.Misses) {
		n = len(r.Misses)
	}
	w("  not found, e.g.:\n")
	for _, m := range r.Misses[:n] {
		w("    %s\n", m)
	}
	if r.verbose {
		w("  disagreements (>1 km):\n")
		for _, m := range r.Disagree {
			w("    %s\n", m)
		}
	}
	return b.String()
}
