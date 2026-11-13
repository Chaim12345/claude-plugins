# סל זול: roadmap

What the app does today, what to build next and why, and what needs help from outside this repository. "Data" notes come from the real Ramat Gan catalog (14 branches, 8,942 products, 12 Nov 2026).

## Shipped

**Data engine (Go, runs on the phone)**
- Every grocery chain in the official list (as tracked by the community scraper), from six kinds of portal: Shufersal, publishedprices (with each chain's published login, done automatically), Bina, laibcatalog, PublishPrice, City Market Shops, plus Wolt and Hazi Hinam. Added from the official list: KT Market and City Market's own portal (72 branches). Left out on purpose: the pharmacies (Super-Pharm, Good Pharm), and Meshnat Yosef's second portal, which publishes empty price files.
- A branch that publishes nothing falls back to another listing of the same shop (same chain name, within 300 m), often on another portal.
- Checked against the official gov.il page (29 retailers, saved Nov 2026): every grocery retailer on it has a client. Six of them refuse foreign IPs: Victory, Carrefour, Hazi Hinam, Mahsanei HaShuk, H. Cohen and Netiv HaHesed. Those, and Super Yuda's password login, are proven only once the app runs on a phone in Israel.
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
- **For you:** recommendations built like X's open-sourced timeline pipeline. Candidate sources: regulars that are due by your own buying rhythm, things bought together with what's in the cart, real deals in the categories you buy, price drops, and staples with big gaps for new users. Then a ranker, filters, category and manufacturer diversity, and feedback: "not interested" and adds change the weights. "הסל הקבוע" adds every due regular in its usual quantity, learned from past baskets.
- **Same product, any brand:** on the product sheet, ranked by unit price.
- **Kosher filter:** matches by product name only (מהדרין, בד"ץ, גלאט), and says so.
- **Diagnostic log:** syncs, portal errors, discovery, geocoding, background runs and crashes, with share and copy (More → יומן אבחון).
- **Deals with conditions:** minimum-basket ("מעל 100"), gift and mix-and-match promotions are shown on the product sheet and the cart, with the chain's own wording, and never counted in totals (227 on the Ramat Gan catalog). Pricing the simple ones ("1+1" on one product) is the next step there.
- **AI deal checks (optional):** in Settings, a free Gemini key from Google AI Studio or any OpenAI-compatible provider (OpenRouter, Groq, a custom URL). The model reads each flagged promotion's wording and its products and says covered, not covered or unclear: covered deals lose the "לבדוק בקופה" warning, the rest are hidden or keep it. Only public promotion texts and product names are sent, from the phone straight to the provider; the key stays in the phone's encrypted storage. Answers are cached until the promotion ends. Ramat Gan's 733 flagged deals take 10 requests, inside the free tier's daily limit.
- **Every product, not only the compared ones.** The catalog used to keep a product only when 3+ nearby branches sold it: 27% of what the files list (Ramat Gan, 13 branches: 8,643 of 32,199). Now it keeps everything: products in one branch (marked "only here"), and each chain's own items (internal codes, weighed deli and butcher items) keyed by chain. 4 km around Ramat Gan: 11,668 → 36,636 products, 10.5 MB (1.7 MB compressed). `go run ./cmd/audit <raw dir> <catalog>` reports what the files hold against what the catalog keeps.
- **Product classification database (AI, background):** with an AI key, every product gets a record (type, category, brand, line, variant, pack size, diet and kashrut tags, own brand) from the model, `gemini-4-hydrogen` by default on a Gemini key (most accurate in a side-by-side on 80 products; about 80 products a minute) or Flash-Lite (about 6x faster). Runs on start-up and after each update over the delta (new or renamed products, most-sold first), within a daily request cap, and is stored in SQLite on the phone. Records feed categories, search (brand, type, diet), diet filters, the product sheet, and **ניתוח נתונים**: brands cheap or dear for their product type, own brand vs national brands, the cheapest per unit in every product type.
- **AI catalog tools (More → ניהול קטלוג):** the same key also tidies the catalog, applied on the phone on top of the files, with a review list and undo for every change:
  - *Categories:* products the files leave in "שונות" get a real category (Ramat Gan, 4 km: 2,114 of 2,184 placed, 22 requests).
  - *Names:* glued sizes and abbreviations are cleaned ("200ג'" → "200 גרם"); every number must survive or the answer is refused, the original name stays searchable, and pack sizes are still read from it.
  - *Merging duplicates:* the same product under two barcodes becomes one product with every chain's price. Candidates need the same pack size, similar names and no branch selling both; the model confirms, and nothing merges until the user approves (or turns on auto-merge).
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
3. **Per-branch opening hours and Shabbat closing.** These aren't in the price files. OSM `opening_hours` covers many branches, and could feed the map and the "go now" advice.
4. **Accessibility pass.** Font scaling up to 200%, TalkBack labels on every control (most have them), and colour-blind-safe deal badges.
5. **Web app parity.** The Expo web build is the same app, so deploy it with the Go server (one binary plus the static files) as the "no install" option.
6. **Kashrut from a real source:** the chains' online-shop data or a community list. The name-based filter catches only about 1% of products.
7. **Recommender v2:** learn the weights from accepted and dismissed cards (a small logistic model on the same features), not by hand.

## Later

- **iOS.** The Swift bridge and `build-go.sh ios` exist, but the build needs a Mac or EAS. CI no longer builds iOS.
- **Receipts.** Photograph a receipt to record what you actually paid, then compare it with the files. That would catch shelf prices that don't match the published ones, which is a consumer-rights angle.
- **Shared family list.** Sync a cart between two phones. This needs a small backend or a peer link.
- **Price alerts by area.** For example, "eggs under ₪12 within 3 km".

## Needs outside help

| What | Why | Who |
|---|---|---|
| Victory, Carrefour, Hazi Hinam and Mahsanei HaShuk tested live | Their portals reject non-Israeli IPs | Anyone running the app in Israel |
| Rami Levy product photos in a public release | The photos belong to the retailer | Permission from the chain, or `UseChainImages = false` |
| Play Store release | The current APK is signed with a debug key | A release keystore and a store listing |
| Open Israeli Supermarkets API token | Used by the server's "more chains" section only | The owner keeps it out of the repo |
