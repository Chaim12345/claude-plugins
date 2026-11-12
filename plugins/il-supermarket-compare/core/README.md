# salzol core

The sync engine behind the סל זול app, written in Go. It downloads the chains' official price files, parses them, matches products across chains, and writes `catalog.json`. The same code runs in three places:

| Where | How | Who it's for |
|---|---|---|
| Phone app | `gomobile bind ./mobile`, a native library the app calls | Everyone. The phone syncs by itself, so nobody hosts anything. |
| Web server | `salzol serve` | People using the web version. A browser can't download the price files itself, because the portals send no CORS headers. |
| Command line | `salzol sync` | Development, scheduled jobs |

## Any location

`directory.json` is the national store directory: every branch the portals list, with coordinates. It's compiled into the binary and the phone library with `go:embed`, so a phone never has to geocode branches itself.

- **Building it:** `salzol directory` downloads every chain's Stores file, maps city codes to names with the CBS localities list on data.gov.il, and geocodes each branch address with OpenStreetMap Nominatim. Nominatim is called at most once per second, with an identifying User-Agent and a permanent cache. When a street can't be found, the branch is placed at its city centre and marked `approx`.
- **Rebuilding:** do it monthly or so. The cache means only new branches are looked up.
- **Choosing stores:** `Directory.Nearby(lat, lon, radius, max)` picks every discount-banner branch in the radius plus the nearest branch of each other banner. A city-centre branch counts only when it's 1.5 km inside the radius.
- **The user's location:** one Nominatim lookup for a typed address (`/api/geocode` or `mobile.Geocode`), or the device's GPS.

## Speed

A cold sync of 8 branches downloads 3.6 MB and finishes in about 5.6 s on a cloud VM: downloads take 0.3–1 s per store, run one chain per goroutine, and parse at about 0.6 s per store in parallel; matching takes 0.5 s. When the portals have nothing new, Sync returns the existing catalog after checking each store's file list (about 3 s, all network). Expect a phone to parse 2–4 times slower than the VM.

## Commands

```bash
go test ./...
go run ./cmd/salzol sync  -data salzol-data                  # writes salzol-data/catalog.json
go run ./cmd/salzol serve -data salzol-data -web ../app      # http://localhost:8080
go run ./cmd/salzol stores RamiLevi                          # list a chain's branches for a config
```

`-config stores.json` takes a JSON `core.Config` (`stores`, `areas`, `min_stores`). Without it, the built-in Ramat Gan / Bnei Brak / Givatayim config in `config.go` is used.

Server endpoints:

| Endpoint | What it does |
|---|---|
| `GET /api/geocode?q=` | Looks up an address |
| `GET /api/nearby?lat=&lon=&radius=` | Lists the stores that would be compared |
| `POST /api/sync?lat=&lon=&radius=&place=` | Starts a sync for that location (no parameters: the default config) and returns a `job` |
| `GET /api/sync?job=` | Progress events for that sync |
| `GET /data.json?job=` | That location's catalog |
| `GET /img/{barcode}` | Product photo, proxied and cached on disk |
| `GET /api/health` | Health check |

Each job is keyed by its set of stores, so neighbours share a catalog, and all jobs share the download cache.

## Phone builds

```bash
go install golang.org/x/mobile/cmd/gomobile@latest && gomobile init
gomobile bind -target=android -androidapi 24 -o salzol.aar ./mobile    # needs the Android NDK
gomobile bind -target=ios -o Salzol.xcframework ./mobile              # needs Xcode on a Mac
```

The `mobile` package exposes:

- `Geocode(dataDir, address)`
- `NearbyStores(lat, lon, radiusKm, max)`
- `SyncNear(dataDir, place, lat, lon, radiusKm, listener)`
- `Sync(dataDir, configJSON, listener)`
- `CancelSync()`
- `DefaultConfig()`
- `ResolveImage(dataDir, barcode)`

Progress arrives as JSON events on the listener.

## Files

| File | What it does |
|---|---|
| `chains.go` | Portal clients: Shufersal, publishedprices.co.il (Rami Levy, Osher Ad, Yochananof, Tiv Taam, Keshet and others), Carrefour. Finds the newest PriceFull file per store. |
| `parse.go` | Streaming XML parser. Handles gzip, UTF-8 with or without a BOM, and UTF-16. |
| `catalog.go` | Matching: barcodes for packaged goods with an outlier filter, name rules for fresh items, keyword categories. |
| `sync.go` | Orchestration, the download cache (keyed by published file name), and the "unchanged" shortcut. |
| `geocode.go` | Nominatim client: rate limit, cache, address cleanup, city-centre fallback. |
| `directory.go` | The national store directory, banners, and the nearby-store choice. |
| `images.go` | Photo lookup by barcode: Rami Levy's CDN, then Open Food Facts. Results are cached for 30 days. |

## Product photos and permissions

Rami Levy's CDN had a photo for 34 of 40 randomly sampled packaged products. Open Food Facts fills some of the gaps. Rami Levy's photos belong to a retailer, so get permission before a public release, or set `core.UseChainImages = false` to use only Open Food Facts.

## Not done yet

- Promotions and club prices (`PromoFull` files).
- Intraday `Price` update files. Sync uses the daily `PriceFull`.
- Carrefour's store list. Its portal timed out from the cloud environment used to build the directory.
- Photos for fresh produce. Rami Levy's produce codes mostly have no photo, so those cards show a placeholder.
