// audit: how many items in the raw price files reach the catalog, and why the rest don't.
// Usage: go run ./cmd/audit <raw dir> <catalog.json>
package main

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	core "github.com/Chaim12345/claude-plugins/plugins/il-supermarket-compare/core"
)

func main() {
	all, _ := filepath.Glob(filepath.Join(os.Args[1], "*PriceFull*"))
	var cat struct {
		Products [][]any
		Stores   []struct{ ID string }
	}
	b, _ := os.ReadFile(os.Args[2])
	json.Unmarshal(b, &cat)
	// only this catalog's branches: <chain>_PriceFull...-<store, 3 digits>-
	var files []string
	for _, f := range all {
		base := filepath.Base(f)
		for _, st := range cat.Stores {
			ch, id, _ := strings.Cut(st.ID, ":")
			n := id
			for len(n) < 3 {
				n = "0" + n
			}
			if strings.HasPrefix(base, ch+"_") && strings.Contains(base, "-"+n+"-") {
				files = append(files, f)
				break
			}
		}
	}
	inCat := map[string]bool{}
	for _, p := range cat.Products {
		inCat[p[0].(string)] = true
	}
	type agg struct {
		stores  map[string]bool
		name    string
		weighed bool
	}
	codes := map[string]*agg{}
	short, weighted, items := 0, 0, 0
	for _, f := range files {
		fh, _ := os.Open(f)
		var r io.Reader = fh
		if gz, err := gzip.NewReader(fh); err == nil {
			r = gz
		}
		its, err := core.ParsePriceFile(r)
		fh.Close()
		if err != nil {
			fmt.Println("parse error", filepath.Base(f), err)
			continue
		}
		for _, it := range its {
			items++
			a := codes[it.Code]
			if a == nil {
				a = &agg{stores: map[string]bool{}, name: it.Name, weighed: it.Weighted}
				codes[it.Code] = a
			}
			a.stores[f] = true
		}
	}
	byStores := map[int]int{}
	var missing []string
	for code, a := range codes {
		switch {
		case len(code) < 7:
			short++
		case a.weighed:
			weighted++
		case !inCat[code]:
			byStores[len(a.stores)]++
			if len(missing) < 4000 {
				missing = append(missing, fmt.Sprintf("%d\t%s\t%s", len(a.stores), code, a.name))
			}
		}
	}
	fmt.Printf("files %d, item rows %d, distinct codes %d, in catalog %d\n", len(files), items, len(codes), len(inCat))
	fmt.Printf("dropped: short internal codes %d, sold by weight %d, packaged but not in catalog by branch count %v\n", short, weighted, byStores)
	sort.Strings(missing)
	os.WriteFile("/tmp/claude-0/-home-user-claude-plugins/3ba52f5b-3ffa-582b-aaf1-fc2b24394318/scratchpad/missing.tsv", []byte(strings.Join(missing, "\n")), 0o644)
}
