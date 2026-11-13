// Package spike is the Go side of the Compose UI test: it owns the data and the search, and the
// Kotlin screen only draws what it returns, one visible row at a time. Bound with gomobile.
package spike

import (
	"bufio"
	"bytes"
	"compress/gzip"
	_ "embed"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed products.tsv.gz
var data []byte

type item struct {
	name, key string
	price     int // agorot, 0 = no price
	stores    int
}

var (
	mu      sync.RWMutex
	items   []item
	results []int32 // indexes into items for the current query
)

// Load reads the embedded 37,153 products. Returns the time it took, in milliseconds.
func Load() int64 {
	t := time.Now()
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return -1
	}
	sc := bufio.NewScanner(zr)
	sc.Buffer(make([]byte, 1<<16), 1<<20)
	var out []item
	for sc.Scan() {
		f := strings.Split(sc.Text(), "\t")
		if len(f) < 3 {
			continue
		}
		p, _ := strconv.Atoi(f[1])
		n, _ := strconv.Atoi(f[2])
		out = append(out, item{name: f[0], key: norm(f[0]), price: p, stores: n})
	}
	mu.Lock()
	items = out
	results = make([]int32, len(out))
	for i := range results {
		results[i] = int32(i)
	}
	mu.Unlock()
	return time.Since(t).Milliseconds()
}

// norm is the app's search normalisation (compare.ts norm): no quote marks, single spaces, lower case.
func norm(s string) string {
	s = strings.NewReplacer(`"`, "", "'", "", "׳", "", "״", "", "`", "").Replace(s)
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

// Search keeps the products whose name has every word of q, most-sold first. Returns the count; the
// rows are then read with Name/Price/Stores by position. Microseconds it took: SearchMicros.
func Search(q string) int {
	t := time.Now()
	terms := strings.Fields(norm(q))
	mu.Lock()
	defer mu.Unlock()
	results = results[:0]
	for i := range items {
		ok := true
		for _, w := range terms {
			if !strings.Contains(items[i].key, w) {
				ok = false
				break
			}
		}
		if ok {
			results = append(results, int32(i))
		}
	}
	lastMicros = time.Since(t).Microseconds()
	return len(results)
}

var lastMicros int64

// SearchMicros is how long the last Search took.
func SearchMicros() int64 { mu.RLock(); defer mu.RUnlock(); return lastMicros }

func row(i int) *item {
	if i < 0 || i >= len(results) {
		return nil
	}
	return &items[results[i]]
}

// Name of result row i.
func Name(i int) string {
	mu.RLock()
	defer mu.RUnlock()
	if r := row(i); r != nil {
		return r.name
	}
	return ""
}

// Price of result row i as text: "12.90 ₪", or "אין מחיר".
func Price(i int) string {
	mu.RLock()
	defer mu.RUnlock()
	r := row(i)
	if r == nil || r.price == 0 {
		return "אין מחיר במחירון"
	}
	return strconv.FormatFloat(float64(r.price)/100, 'f', 2, 64) + " ₪"
}

// Stores is how many branches sell result row i.
func Stores(i int) int {
	mu.RLock()
	defer mu.RUnlock()
	if r := row(i); r != nil {
		return r.stores
	}
	return 0
}
