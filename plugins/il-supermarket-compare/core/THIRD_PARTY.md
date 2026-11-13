# Third-party material

## israeli-supermarket-scarpers (non-commercial license)

`portals_extra.go` and the extra logins in `chains.go` (`ppLogins`) are derived from
**israeli-supermarket-scarpers** by **Sefi Erlich**:
https://github.com/OpenIsraeliSupermarkets/israeli-supermarket-scarpers

**Changes:**
- Rewritten in Go.
- Fetches only one store's newest PriceFull and PromoFull files and each chain's Stores file. No intraday files and no history.
- Portal URLs, chain IDs and published logins come from the original. Listing, downloading and parsing were reimplemented.
- The PromoFull file types (Shufersal category 4, Bina `WFileType` 5, the `PromoFull` name prefix elsewhere) are taken from the scraper's file-type tables. `promo.go` reads PromoFull files into its own model. The reference parser repository (israeli-supermarket-parsers, same author and license) was not used as source; the tag names come from reading the real files.

That project's license allows **non-commercial use only**, with attribution. Commercial use of this material requires the original author's written permission (contact details are in that repository's `LICENSE.txt`). The rest of this directory is under this repository's license.

## Offline address index

`geoindex.bin.gz` is derived from OpenStreetMap data. © OpenStreetMap contributors, available under the Open Database License (ODbL): https://www.openstreetmap.org/copyright. As a derived database it is also available under the ODbL; rebuild it with `salzol osmindex build` (see `osmindex/README.md`).

## Store coordinates

`directory.json` holds coordinates geocoded with OpenStreetMap Nominatim. The data is © OpenStreetMap contributors, available under the Open Database License (ODbL): https://www.openstreetmap.org/copyright

## City names

City codes are mapped with the Central Bureau of Statistics localities list, published on data.gov.il.
