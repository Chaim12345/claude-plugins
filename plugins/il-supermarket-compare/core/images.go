package core

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

var (
	imgMu    sync.Mutex
	imgCache = map[string]map[string]imageEntry{} // dataDir -> barcode -> entry
)

// Product photos. The price files have none, so a photo is looked up by barcode, in order:
//  1. Rami Levy's product CDN, which serves photos by item code (85% of a random sample of
//     packaged goods; a missing product returns HTTP 403, never a placeholder image).
//  2. Open Food Facts, an open database (CC BY-SA photos), via its API.
//
// Source 1 belongs to a retailer. Its terms likely don't allow reuse in a public app, so get
// permission (or switch it off with UseChainImages=false) before publishing to the app stores.
var UseChainImages = true

const ramiLevyImage = "https://img.rami-levy.co.il/product/{code}/small.jpg"

// ImageSources are the direct URL templates clients may try in order before calling ResolveImage.
var ImageSources = []string{ramiLevyImage}

var barcodeRx = regexp.MustCompile(`^\d{7,14}$`)

// ResolveImage returns a photo URL for a barcode, or "" if none is known. Results, including misses,
// are cached under dataDir/images.json, so each barcode is looked up at most once a month.
func ResolveImage(ctx context.Context, client *http.Client, dataDir, code string) (string, error) {
	if !barcodeRx.MatchString(code) {
		return "", nil
	}
	imgMu.Lock()
	e, ok := cacheFor(dataDir)[code]
	imgMu.Unlock()
	if ok && time.Since(time.Unix(e.At, 0)) < 30*24*time.Hour {
		return e.URL, nil
	}
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	url := ""
	if UseChainImages {
		u := strings.ReplaceAll(ramiLevyImage, "{code}", code)
		if ok, _ := isImage(ctx, client, u); ok {
			url = u
		}
	}
	if url == "" {
		url, _ = openFoodFacts(ctx, client, code)
	}
	imgMu.Lock()
	cache := cacheFor(dataDir)
	cache[code] = imageEntry{URL: url, At: time.Now().Unix()}
	saveImageCache(dataDir, cache)
	imgMu.Unlock()
	return url, nil
}

func isImage(ctx context.Context, c *http.Client, u string) (bool, error) {
	req, _ := http.NewRequestWithContext(ctx, "HEAD", u, nil)
	req.Header.Set("User-Agent", userAgent)
	resp, err := c.Do(req)
	if err != nil {
		return false, err
	}
	resp.Body.Close()
	return resp.StatusCode == 200 && strings.HasPrefix(resp.Header.Get("Content-Type"), "image/"), nil
}

func openFoodFacts(ctx context.Context, c *http.Client, code string) (string, error) {
	u := fmt.Sprintf("https://world.openfoodfacts.org/api/v2/product/%s.json?fields=image_front_small_url,image_small_url", code)
	resp, err := get(ctx, c, u)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var r struct {
		Product struct {
			Front string `json:"image_front_small_url"`
			Any   string `json:"image_small_url"`
		} `json:"product"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&r); err != nil {
		return "", err
	}
	if r.Product.Front != "" {
		return r.Product.Front, nil
	}
	return r.Product.Any, nil
}

type imageEntry struct {
	URL string `json:"u"`
	At  int64  `json:"t"`
}

// cacheFor returns the in-memory cache for dir, loading it from disk once. Call with imgMu held.
func cacheFor(dir string) map[string]imageEntry {
	if m, ok := imgCache[dir]; ok {
		return m
	}
	m := loadImageCache(dir)
	imgCache[dir] = m
	return m
}

func loadImageCache(dir string) map[string]imageEntry {
	m := map[string]imageEntry{}
	if b, err := os.ReadFile(filepath.Join(dir, "images.json")); err == nil {
		json.Unmarshal(b, &m)
	}
	return m
}

func saveImageCache(dir string, m map[string]imageEntry) {
	os.MkdirAll(dir, 0o755)
	writeJSON(filepath.Join(dir, "images.json"), m)
}
