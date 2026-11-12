# סל זול: roadmap

What the app does today, what to build next and why, and what needs help from outside this repository. "Data" notes come from the real Ramat Gan catalog (14 branches, 8,942 products, 12 Nov 2026).

## Shipped

**Data engine (Go, runs on the phone)**
- 30+ chains from five kinds of portal: Shufersal, publishedprices, Bina, laibcatalog, PublishPrice, plus Wolt and Hazi Hinam. KT Market was added from the official list.
- Barcode matching with outlier filtering, and name rules for fresh produce and meat. Promotions cover price, X-for-Y, percent off, "second one for X" and club deals, with unit limits taken from the text or `RedemptionLimit`.
- Metadata the chains publish but nobody uses: pack size (agreed by chains), manufacturer, made in Israel, "not sold here for N days", and "price changed N days ago" (see `core/README.md`).
- Any location: an embedded store directory (1,253 branches) and an offline address index. On-device discovery adds the chains that block foreign IPs.

**App (Expo, Android build)**
- **Home:** a price index per branch, category tiles, deals on your own products, "my regulars", the best real deals, price moves since the last sync, and the widest price gaps.
- **Search:** filters for on sale and made in Israel, and the manufacturer is searchable. Unit prices cover 96% of products.
- **Deals:** every number is measured against the cheapest regular price nearby, never against a branch's own inflated shelf price.
- **Cart:**
  - The cheapest branch, and how much the cheapest branch saves against the dearest.
  - Swaps, and a split-trip verdict with a cost per extra km.
  - Club prices, and items that are "maybe not on the shelf".
  - An in-store checklist per branch, grouped by department.
- **Deals with conditions:** minimum-basket ("מעל 100"), gift and mix-and-match promotions are shown on the product sheet and the cart, with the chain's own wording, and never counted in totals (227 on the Ramat Gan catalog). Pricing the simple ones ("1+1" on one product) is the next step there.
- **Product sheet:** every branch, the current best deal, how fresh each price is, the price changes the app saw, and a 30-day history for followed products.
- **Watching:** a watchlist, the usual basket, local notifications and a daily background refresh.
- **Also:**
  - Map and navigation.
  - Share and copy.
  - Paste a shopping list or scan a barcode.
  - Saved lists, onboarding and dark mode.
- CI runs Go and app unit tests, plus an Android emulator end-to-end run (typed address, GPS, sync, add to cart, compare).

## Next (highest value first)

1. **Real-device pass.** Camera scanning, notifications, the background task and map pins have only run in a browser and an emulator. One afternoon on a phone in Israel would also exercise the four blocked portals (Victory, Carrefour, Hazi Hinam, Mahsanei HaShuk).
2. **Price history from the files, not only from syncs.** `PriceUpdateTime` dates each price change. Keeping the last 2-3 PriceFull files per branch (about 1 MB each) would give a "price went up 9% last week" line from day one, instead of after the second sync.
3. **Smarter "my regulars".** Learn the usual quantity and how often each item is bought, then offer "your weekly basket" in one tap and a reminder when a regular is on a real deal.
4. **Brand-free comparison for staples.** Milk 3% 1 L, eggs L 12, sugar 1 kg: group them by type, size and fat across brands, so "cheapest milk around me" works whatever the brand. Swaps already have the matching rules; this makes them a search.
5. **Kashrut and dietary filters.** Only about 1% of names mention מהדרין or בד"ץ, so names aren't enough. This needs the chains' online-shop data or a community list. Until then, mark it "by name only".
6. **Per-branch opening hours and Shabbat closing.** These aren't in the price files. OSM `opening_hours` covers many branches, and could feed the map and the "go now" advice.
7. **Accessibility pass.** Font scaling up to 200%, TalkBack labels on every control (most have them), and colour-blind-safe deal badges.
8. **Web app parity.** The Expo web build is the same app, so deploy it with the Go server (one binary plus the static files) as the "no install" option.

## Later

- **iOS.** The Swift bridge and `build-go.sh ios` exist, but the build needs a Mac or EAS. CI no longer builds iOS.
- **Receipts.** Photograph a receipt to record what you actually paid, then compare it with the files. That would catch shelf prices that don't match the published ones, which is a consumer-rights angle.
- **Shared family list.** Sync a cart between two phones. This needs a small backend or a peer link.
- **Price alerts by area.** For example, "eggs under ₪12 within 3 km".
- **More chains from the gov.il list.** The official page (gov.il/he/pages/cpfta_prices_regulations) blocks automated fetches from here. Someone in Israel can save it, and any chain missing from `ChainNames` can be added with one of the five existing portal clients.

## Needs outside help

| What | Why | Who |
|---|---|---|
| Victory, Carrefour, Hazi Hinam and Mahsanei HaShuk tested live | Their portals reject non-Israeli IPs | Anyone running the app in Israel |
| Rami Levy product photos in a public release | The photos belong to the retailer | Permission from the chain, or `UseChainImages = false` |
| Play Store release | The current APK is signed with a debug key | A release keystore and a store listing |
| Open Israeli Supermarkets API token | Used by the server's "more chains" section only | The owner keeps it out of the repo |
