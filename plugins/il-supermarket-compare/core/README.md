# salzol core

The sync engine behind the סל זול app, written in Go. It downloads the chains' official price files, parses them, matches products across chains, and writes `catalog.json`. The same code runs in three places:

| Where | How | Who it's for |
|---|---|---|
| Phone app | `gomobile bind ./mobile`, a native library the app calls | Everyone. The phone syncs by itself, so nobody hosts anything. |
| Web server | `salzol serve` | People using the web version. A browser can't download the price files itself, because the portals send no CORS headers. |
| Command line | `salzol sync` | Development, scheduled jobs |

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

Server endpoints: `GET /data.json` (the catalog), `POST /api/sync` (start a sync), `GET /api/sync` (progress events), `GET /img/{barcode}` (product photo, proxied and cached on disk), `GET /api/health`.

## Phone builds

```bash
go install golang.org/x/mobile/cmd/gomobile@latest && gomobile init
gomobile bind -target=android -androidapi 24 -o salzol.aar ./mobile    # needs the Android NDK
gomobile bind -target=ios -o Salzol.xcframework ./mobile              # needs Xcode on a Mac
```

The `mobile` package exposes `Sync(dataDir, configJSON, listener)`, `CancelSync()`, `DefaultConfig()` and `ResolveImage(dataDir, barcode)`. Progress arrives as JSON events on the listener.

## Files

| File | What it does |
|---|---|
| `chains.go` | Portal clients: Shufersal, publishedprices.co.il (Rami Levy, Osher Ad, Yochananof, Tiv Taam, Keshet and others), Carrefour. Finds the newest PriceFull file per store. |
| `parse.go` | Streaming XML parser. Handles gzip, UTF-8 with or without a BOM, and UTF-16. |
| `catalog.go` | Matching: barcodes for packaged goods with an outlier filter, name rules for fresh items, keyword categories. |
| `sync.go` | Orchestration, the download cache (keyed by published file name), and the "unchanged" shortcut. |
| `images.go` | Photo lookup by barcode: Rami Levy's CDN, then Open Food Facts. Results are cached for 30 days. |

## Product photos and permissions

Rami Levy's CDN had a photo for 34 of 40 randomly sampled packaged products. Open Food Facts fills some of the gaps. Rami Levy's photos belong to a retailer, so get permission before a public release, or set `core.UseChainImages = false` to use only Open Food Facts.

## Not done yet

- Promotions and club prices (`PromoFull` files).
- Intraday `Price` update files. Sync uses the daily `PriceFull`.
- Store discovery with geocoding in Go. The store list is still a config.
- Photos for fresh produce. Rami Levy's produce codes mostly have no photo, so those cards show a placeholder.
