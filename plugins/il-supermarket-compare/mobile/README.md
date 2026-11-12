# סל זול: phone app

An Expo (React Native) app for iOS and Android, with a web build from the same code. You choose where you shop, browse products with photos, add them to a cart, and see which branch is cheapest for the whole basket.

## How prices reach the phone

| Build | Sync engine | Needs a server? |
|---|---|---|
| iOS / Android release | The Go core (`../core`), compiled with gomobile into `modules/salzol-native` and run on the device | No |
| Expo Go, web | The same Go core running as `salzol serve`, called over HTTP | Yes |

`src/lib/engine.ts` picks the engine. If the native module is present, everything runs on the phone: download, parse, match, and photo lookup. Otherwise the app uses `EXPO_PUBLIC_SALZOL_URL`, or the same origin on web.

On iOS and Android, a typed address is looked up with the phone's built-in geocoder through `expo-location`, which is free and needs no API key. GPS comes from the same library. The web build asks the server instead (`/api/geocode`, OpenStreetMap).

## Run

```bash
npm install
npm test          # shared logic (node --test)
npm run typecheck

# Development against a local server:
(cd ../core && go run ./cmd/salzol serve -data salzol-data)
EXPO_PUBLIC_SALZOL_URL=http://<your-computer's-LAN-IP>:8080 npx expo start

# Web build served by the Go server:
npx expo export -p web && (cd ../core && go run ./cmd/salzol serve -web ../mobile/dist)
```

## Phone builds with on-device sync

```bash
scripts/build-go.sh android        # gomobile -> modules/salzol-native/android/libs/salzol.aar (needs Android SDK + NDK)
scripts/build-go.sh ios            # gomobile -> modules/salzol-native/ios/Frameworks/Salzol.xcframework (macOS + Xcode)
npx expo run:android               # or: npx eas-cli build -p android
```

The native module (`modules/salzol-native`) exposes `syncNear`, `nearbyStores`, `lastCatalog`, `resolveImage` and `cancelSync`, and streams progress as `onSyncEvent`.

## Layout

| Path | What it is |
|---|---|
| `src/app/(tabs)/index.tsx` | Products: search, categories, branch toggles, product grid |
| `src/app/(tabs)/cart.tsx` | Basket comparison: per-branch totals, like-for-like %, missing items, split purchase |
| `src/app/product/[code].tsx` | A product's price at every branch |
| `src/app/location.tsx` | Address or GPS, radius, preview of the branches to compare |
| `src/lib/compare.ts` | Search and basket maths (tested with `node --test`) |
| `src/lib/engine.ts` | On-device vs server engine |
| `src/lib/store.tsx` | App state: catalog, cart, location, sync progress |
| `src/app/map.tsx`, `src/components/BranchMap.native.tsx` | Branch map: MapLibre Native with the free OpenFreeMap style (no API key); on web a branch list with navigation links |
| `src/lib/mapgeo.ts` | Bearing, bounds, fit, navigation links (Waze / Google Maps), branch pins (tested) |
| `src/lib/shareText.ts` | The Hebrew text for sharing a cart or one product; `itemLines` lets the paste-list screen take it back (tested round trip) |
| `src/app/settings.tsx`, `src/lib/settings.tsx`, `src/lib/prefs.ts` | Settings: default radius, trip cost (`salzol:kmcost`), club cards, language, clear data, about. Add sections in `src/components/settings/extraSections.tsx` |
| `src/components/Onboarding.tsx` | First-run introduction (flag `salzol:onboarded`) |
| `src/i18n/` | `t()` helper and the Hebrew / English tables for the new screens only |

## Map

The map needs a development build (`npx expo run:android|ios`, or EAS): `@maplibre/maplibre-react-native` is native code, so it is absent from Expo Go and the web build, where the screen falls back to a list of branches. Tiles come from OpenFreeMap (`https://tiles.openfreemap.org/styles/liberty`), which needs no key or account. Its terms require the attribution "OpenFreeMap © OpenMapTiles Data from OpenStreetMap": MapLibre shows its own attribution button and the screen prints the line under the map. Navigation opens Waze, Google Maps (and Apple Maps on iOS) through https links.

Shared texts end with a link to the app: set `EXPO_PUBLIC_SALZOL_SHARE_URL` to change it.
