# סל זול: web app

A Hebrew, right-to-left shopping app. You browse and search products, add them to a cart, and see which branch is cheapest for the whole basket, with like-for-like totals, missing items, and the split-purchase total.

`index.html` is a single page that reads `data.json` (the catalog built by `../core`). It runs in two modes:

- **With the Go server** (`salzol serve -web ../app`): shows product photos and an "עדכון מחירים" (update prices) button. The button asks the server to fetch the newest price files and shows progress while it runs.
- **Static** (any file host, or a Claude artifact): uses the `data.json` next to it, with no photos and no Sync button. The page detects which mode it's in by calling `/api/health`.

```bash
cd ../core && go run ./cmd/salzol serve -data salzol-data -web ../app   # then open http://localhost:8080
```

`data.json` is generated and not committed. In static mode, copy `salzol-data/catalog.json` here as `data.json`.

The cart is saved in the browser only.
