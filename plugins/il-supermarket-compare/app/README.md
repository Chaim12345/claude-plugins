# סל זול: the shopping app prototype

A standalone web version of the `il-supermarket-compare` skill. You browse products, add them to a cart, and see which branch is cheapest for the whole basket. It doesn't need Claude to run.

## How it fits together

| File | Role |
|---|---|
| `ingest.py` | Downloads today's official price files with the skill's own fetchers (`../skills/.../scripts/chains.py`), matches products across chains and writes `data.json`. |
| `index.html` | The app: a single page that reads `data.json` next to it. Hebrew, right-to-left, works at phone width. |
| `data.json` | Generated data, not committed. Run `ingest.py` to create it. |

## Matching

- **Packaged goods** are matched across chains by barcode. A product is kept only if at least 3 stores sell it (`--min-stores`). A price more than 4× or less than ¼ of the product's median price is dropped as a probable data error.
- **Fresh items** (produce, chicken, beef) have chain-specific codes, so they're matched by name rules in `FRESH`. Each rule has exclusions (organic, frozen, nets, pre-seasoned) and a sanity range in ₪/kg. The app shows which product name was matched at each store.
- **Categories** come from ordered keyword rules (`RULES`). About a fifth of the products fall into "שונות"; search still finds them.

## Run it

```bash
pip install requests
python ingest.py              # writes data.json (about 1 min with a warm cache; the first run also geocodes)
python -m http.server 8000    # then open http://localhost:8000
```

To change the area, edit `STORES` (the branches) and `AREAS` (the starting points used for distances) in `ingest.py`. Store IDs come from the skill's `find_stores.py` output.

## Keeping it fresh

Chains publish new files every day. Rerun `ingest.py` once a day and republish `index.html` together with `data.json`, either to a static host or to the same Claude artifact URL. A daily scheduled Claude Code task in a cloud environment with open network access can do both steps.

## Known limits

- Shelf prices only. Promotions and club prices (Promo files) aren't parsed yet.
- Carrefour's portal reset connections from the cloud environment used to build this, so it's left out of the default store list.
- Distances are straight-line. One branch (יש חסד השומר) couldn't be geocoded and uses the city centre; it's marked `~`.
- The cart is saved in the browser only.
