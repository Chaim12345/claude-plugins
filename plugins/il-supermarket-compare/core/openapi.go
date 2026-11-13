package core

// Prices from the Open Israeli Supermarkets API (https://data.openisraelisupermarkets.co.il), a
// project by Sefi Erlich that ingests every chain's official files. It covers chains whose portals
// can't be reached from everywhere (Victory, Carrefour, Hazi Hinam, Yellow...), so the basket
// comparison uses it to add those chains' nearby branches. Prices there can be a few days old;
// each one carries its date. The API needs a personal token (SALZOL_OSM_TOKEN), never committed.

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const openAPIURL = "https://data.openisraelisupermarkets.co.il"

// ChainCodes maps portal keys to the chains' GS1 codes, as used in the files and by the API.
var ChainCodes = map[string]string{
	"shufersal": "7290027600007", "RamiLevi": "7290058140886", "osherad": "7290103152017", "yohananof": "7290803800003",
	"TivTaam": "7290873255550", "Keshet": "7290785400000", "doralon": "7290492000005", "freshmarket": "7290876100000",
	"SalachD": "7290526500006", "Stop_Market": "7290639000004", "politzer": "7291059100008", "Paz_bo": "7290644700005",
	"yuda_ho": "7290058177776", "SuperCofixApp": "7291056200008", "carrefour": "7290055700007", "quik": "7291029710008",
	"victory": "7290696200003", "mahsanei": "7290661400001", "hcohen": "7290455000004", "wolt": "7290058249350",
	"hazihinam": "7290700100008", "bareket": "7290875100001", "kingstore": "7290058108879", "maayan2000": "7290058159628",
	"zolvebegadol": "7290058173198", "supersapir": "7290058156016", "shukhair": "7290058148776", "shefa": "7290058134977",
	"citymarket": "7290058266241",
}

// notGrocery are chains in the API that aren't supermarkets (pharmacies).
var notGrocery = map[string]bool{"7290172900007": true, "7290058197699": true}

type OpenAPI struct {
	Token  string
	Client *http.Client

	mu     sync.Mutex
	prices map[string]cachedPrices // barcode -> cross-chain prices
	stores map[string]cachedStores // chain code -> store addresses
	seen   map[string]time.Time    // chain code -> when the API last ingested its files
	seenAt time.Time
}

// MaxChainAge drops chains whose files the API hasn't ingested recently.
const MaxChainAge = 72 * time.Hour

// chainSeen reports when the API last ingested each chain (cached for an hour).
func (a *OpenAPI) chainSeen(ctx context.Context) map[string]time.Time {
	a.mu.Lock()
	if a.seen != nil && time.Since(a.seenAt) < time.Hour {
		defer a.mu.Unlock()
		return a.seen
	}
	a.mu.Unlock()
	var r struct {
		Chains []struct {
			Chain struct {
				ChainCode  json.Number `json:"chainCode"`
				ObservedAt string      `json:"observedAt"`
			} `json:"chain"`
		} `json:"chains"`
	}
	out := map[string]time.Time{}
	if err := a.getJSON(ctx, "/chains/?includeStores=false&includeStats=false", &r); err == nil {
		for _, c := range r.Chains {
			t, err := time.Parse(time.RFC3339, c.Chain.ObservedAt)
			if err != nil {
				continue
			}
			if code := c.Chain.ChainCode.String(); t.After(out[code]) {
				out[code] = t
			}
		}
	}
	a.mu.Lock()
	a.seen, a.seenAt = out, time.Now()
	a.mu.Unlock()
	return out
}

type cachedPrices struct {
	at   time.Time
	rows []APIPrice
}
type cachedStores struct {
	at   time.Time
	rows map[int]apiStore // store number -> address
}
type apiStore struct{ Address, City string }

// APIPrice is one product's current shelf price at one store.
type APIPrice struct {
	ChainCode   string
	ChainName   string
	StoreNumber int
	StoreName   string
	City        string
	Price       float64
	OnSale      bool
	Updated     string
}

func NewOpenAPI(token string) *OpenAPI {
	return &OpenAPI{Token: strings.TrimSpace(token), Client: &http.Client{Timeout: 40 * time.Second},
		prices: map[string]cachedPrices{}, stores: map[string]cachedStores{}}
}

func (a *OpenAPI) getJSON(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, "GET", openAPIURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+a.Token)
	req.Header.Set("User-Agent", userAgent)
	resp, err := a.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case 200:
	case 401, 403:
		return fmt.Errorf("open supermarkets API: token rejected (HTTP %d)", resp.StatusCode)
	default:
		return fmt.Errorf("open supermarkets API: HTTP %d for %s", resp.StatusCode, strings.SplitN(path, "?", 2)[0])
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// PricesFor returns a barcode's current prices at every store the API knows.
func (a *OpenAPI) PricesFor(ctx context.Context, barcode string) ([]APIPrice, error) {
	a.mu.Lock()
	if c, ok := a.prices[barcode]; ok && time.Since(c.at) < 30*time.Minute {
		a.mu.Unlock()
		return c.rows, nil
	}
	a.mu.Unlock()
	var r struct {
		ChainComparison []struct {
			ChainName   string `json:"chainName"`
			ChainCode   string `json:"chainCode"`
			StorePrices []struct {
				StoreName   string  `json:"storeName"`
				StoreNumber int     `json:"storeNumber"`
				City        string  `json:"city"`
				TotalPrice  float64 `json:"totalPrice"`
				IsOnSale    bool    `json:"isOnSale"`
				LastUpdated string  `json:"lastUpdated"`
				IsCurrent   bool    `json:"isCurrent"`
			} `json:"storePrices"`
		} `json:"chainComparison"`
	}
	if err := a.getJSON(ctx, "/analytics/price-comparison/cross-chain/"+url.PathEscape(barcode)+"?current_only=true", &r); err != nil {
		return nil, err
	}
	var rows []APIPrice
	for _, c := range r.ChainComparison {
		for _, s := range c.StorePrices {
			if !s.IsCurrent || s.TotalPrice <= 0 {
				continue
			}
			rows = append(rows, APIPrice{ChainCode: c.ChainCode, ChainName: c.ChainName, StoreNumber: s.StoreNumber, StoreName: s.StoreName,
				City: s.City, Price: s.TotalPrice, OnSale: s.IsOnSale, Updated: s.LastUpdated})
		}
	}
	a.mu.Lock()
	a.prices[barcode] = cachedPrices{at: time.Now(), rows: rows}
	a.mu.Unlock()
	return rows, nil
}

// storeAddresses returns a chain's branch addresses (cached for a day).
func (a *OpenAPI) storeAddresses(ctx context.Context, chainCode string) map[int]apiStore {
	a.mu.Lock()
	if c, ok := a.stores[chainCode]; ok && time.Since(c.at) < 24*time.Hour {
		a.mu.Unlock()
		return c.rows
	}
	a.mu.Unlock()
	var r struct {
		Stores []struct {
			StoreNumber int `json:"storeNumber"`
			Address     struct {
				StoreAddress string `json:"storeAddress"`
				City         string `json:"city"`
			} `json:"address"`
		} `json:"stores"`
	}
	out := map[int]apiStore{}
	if err := a.getJSON(ctx, "/stores/?chain_id="+chainCode, &r); err == nil {
		for _, s := range r.Stores {
			out[s.StoreNumber] = apiStore{Address: s.Address.StoreAddress, City: s.Address.City}
		}
	}
	a.mu.Lock()
	a.stores[chainCode] = cachedStores{at: time.Now(), rows: out}
	a.mu.Unlock()
	return out
}

// ExtraStore is a nearby branch of a chain the local catalog doesn't cover, priced through the API.
type ExtraStore struct {
	Chain     string         `json:"chain"`
	ChainCode string         `json:"chainCode"`
	Branch    string         `json:"branch"`
	City      string         `json:"city"`
	Km        float64        `json:"km"`
	Approx    bool           `json:"approx"`
	Prices    map[string]int `json:"prices"` // barcode -> agorot (unit price)
	OnSale    []string       `json:"onSale,omitempty"`
	ChainSeen string         `json:"chainSeen"` // when the API last ingested this chain's files (RFC 3339)
}

// NearbyExtra prices the given barcodes at branches within radiusKm of (lat, lon) belonging to
// chains not in skipChains (GS1 codes). Branch locations come from the directory when it knows the
// branch, else from the API's address, geocoded (at most maxNewGeocodes new lookups per call; the
// rest fall back to their city centre).
func NearbyExtra(ctx context.Context, api *OpenAPI, geo *Geocoder, dir *Directory, barcodes []string, lat, lon, radiusKm float64, skipChains map[string]bool) ([]ExtraStore, error) {
	const maxNewGeocodes = 8
	type key struct {
		chain string
		num   int
	}
	byStore := map[key]*ExtraStore{}
	var mu sync.Mutex
	var firstErr error
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	results := make([][]APIPrice, len(barcodes))
	for i, bc := range barcodes {
		wg.Add(1)
		go func(i int, bc string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			rows, err := api.PricesFor(ctx, bc)
			if err != nil {
				mu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
				return
			}
			results[i] = rows
		}(i, bc)
	}
	wg.Wait()
	if firstErr != nil && strings.Contains(firstErr.Error(), "token") {
		return nil, firstErr
	}
	seen := api.chainSeen(ctx)

	// Directory branches by chain code + store number.
	codeOf := map[string]string{}
	for k, v := range ChainCodes {
		codeOf[k] = v
	}
	known := map[key]DirStore{}
	if dir != nil {
		for _, s := range dir.Stores {
			n, err := strconv.Atoi(s.StoreID)
			if c, ok := codeOf[s.Chain]; ok && err == nil {
				known[key{c, n}] = s
			}
		}
	}
	newGeo := 0
	locate := func(chainCode string, num int, city string) (ll [2]float64, approx, ok bool) {
		if s, found := known[key{chainCode, num}]; found && s.Lat != 0 {
			return [2]float64{s.Lat, s.Lon}, s.Approx, true
		}
		addr := api.storeAddresses(ctx, chainCode)[num]
		if addr.City == "" {
			addr.City = city
		}
		if addr.City == "" {
			return ll, false, false
		}
		// Cheap first: skip whole cities that are far away.
		centre, found, _ := geo.Lookup(ctx, normCity(addr.City)+", ישראל")
		if !found || Km(lat, lon, centre[0], centre[1]) > radiusKm+maxFromCentreKm {
			return ll, false, false
		}
		if newGeo < maxNewGeocodes && addr.Address != "" {
			newGeo++
			if p, exact, ok := geo.LocateStore(ctx, addr.Address, addr.City); ok {
				return p, !exact, true
			}
		}
		return centre, true, true
	}

	for i, rows := range results {
		bc := barcodes[i]
		for _, r := range rows {
			if skipChains[r.ChainCode] || notGrocery[r.ChainCode] || strings.Contains(r.StoreName, "אונליין") {
				continue
			}
			if t, ok := seen[r.ChainCode]; len(seen) > 0 && (!ok || time.Since(t) > MaxChainAge) {
				continue // the API hasn't refreshed this chain lately
			}
			k := key{r.ChainCode, r.StoreNumber}
			st := byStore[k]
			if st == nil {
				ll, approx, ok := locate(r.ChainCode, r.StoreNumber, r.City)
				if !ok {
					byStore[k] = &ExtraStore{} // remember "not near", so it isn't located again
					continue
				}
				d := Km(lat, lon, ll[0], ll[1])
				limit := radiusKm
				if approx {
					limit -= 1.5
				}
				if d > limit {
					byStore[k] = &ExtraStore{}
					continue
				}
				st = &ExtraStore{Chain: chainLabel(r.ChainCode, r.ChainName), ChainCode: r.ChainCode, Branch: r.StoreName, City: r.City,
					Km: math.Round(d*10) / 10, Approx: approx, Prices: map[string]int{}}
				if t, ok := seen[r.ChainCode]; ok {
					st.ChainSeen = t.UTC().Format(time.RFC3339)
				}
				byStore[k] = st
			}
			if st.Prices == nil {
				continue
			}
			st.Prices[bc] = int(math.Round(r.Price * 100))
			if r.OnSale {
				st.OnSale = append(st.OnSale, bc)
			}
		}
	}
	geo.Save()
	var out []ExtraStore
	// The API's per-product coverage is patchy, so a branch is only worth showing when it has
	// prices for at least half the basket.
	need := (len(barcodes) + 1) / 2
	for _, s := range byStore {
		if s.Prices != nil && len(s.Prices) >= need {
			out = append(out, *s)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if len(out[i].Prices) != len(out[j].Prices) {
			return len(out[i].Prices) > len(out[j].Prices)
		}
		return out[i].Km < out[j].Km
	})
	return out, nil
}

// chainLabel prefers the name people use ("ויקטורי") over the API's company name.
func chainLabel(code, apiName string) string {
	for k, c := range ChainCodes {
		if c == code {
			if n, ok := ChainNames[k]; ok {
				return n
			}
		}
	}
	return strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(apiName, "בע\"מ"), "בע"))
}
