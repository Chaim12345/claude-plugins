# osmindex: offline geocoding for Israeli addresses

A compact index (streets, house numbers, malls, municipalities) built from an OpenStreetMap
extract. It answers `Lookup("רח' הרצל 15", "רמת גן")` without any network call, with a
precision of `house`, `street`, `poi` or `city`.

## Data and licence

* Source: OpenStreetMap, e.g. the openstreetmap.fr "israel" extract (`israel.osm.pbf`).
* **© OpenStreetMap contributors, available under the Open Database Licence (ODbL).**
  The index is a derived database: anything that ships it (the phone app, a server) must show
  that attribution, and a redistributed copy of the index stays under ODbL (share-alike).
  <https://www.openstreetmap.org/copyright>
* The `.pbf` and the built index are not committed (see `.gitignore`).

## Rebuild

```
cd plugins/il-supermarket-compare/core
go build -o salzol ./cmd/salzol
./salzol osmindex build -pbf israel.osm.pbf -out osmindex.bin.gz
./salzol osmindex eval  -index osmindex.bin.gz -directory directory.json [-v]
```

Build takes about 8 s and 380 MB RAM on 4 cores; the file is about 1.1 MB (gzip'd varint
binary, coordinates as int32 microdegrees). Three scans of the PBF: relations (municipal
boundaries), ways (streets, addressed buildings, malls, shops), nodes (coordinates,
addresses, places).

## How it works

* **City assignment**: every point gets its city from the municipal polygon
  (`boundary=administrative`, `admin_level=8`, multipolygons stitched from member ways,
  point-in-polygon over a grid of bounding boxes, smallest polygon wins). Points in a
  *regional council* polygon, or in none, fall back to `addr:city`, then the nearest
  `place=city|town|village|hamlet` node (kibbutzim and moshavim are such nodes).
  Streets are split per city, so a road crossing Ramat Gan / Givatayim / Bnei Brak is three
  entries.
* **Normalisation** (`norm.go`, shared by build and query): quotes, geresh and gershayim
  dropped; hyphens, `|`, `,`, dots become spaces; street-type prefixes (`רח'`, `רחוב`,
  `שד'`, `שדרות`, `דרך`, `סמטת`, `כיכר`) removed; `קריית`/`ק.` -> `קרית`;
  `תל אביב - יפו` / `תל אביב`; `ר"ג`, `ת"א`...; names also come from `name:he`, `name`,
  `old_name`, `alt_name`, `official_name`, `short_name`.
* **Lookup order**: exact house number -> interpolation between the neighbouring numbers
  on the same side of the street (not if they are more than 1.5 km apart) -> nearest known
  number (reported as `street`) -> street point -> mall/commercial-centre POI -> city centre.
  Street matching inside the right city only: exact, spelling skeleton (no vav/yod,
  honorifics dropped), one typo for names of 5+ letters, shared-words match.
* `LookupBranch(banner, name, city, address)` matches a branch to an OSM `shop=supermarket`
  etc. POI of the same brand in the same city. It is reported separately and is **not** used
  by `Lookup`: see below.

## Evaluation (1,163 directory branches with address and city)

| | online (stored) | first-cut probe | osmindex |
|---|---|---|---|
| street level or better | 731 | 437 | **840** (house 473, street 352, poi 15) |
| city centre only | | | 311 |
| not found | | 726 | 12 (city unknown) |
| within 1 km of online street-level result | | 396 | **646 of 687 (94.0%)** |

Remaining misses: villages/kibbutzim and "unknown" addresses (city-only is the right answer
there), road-side addresses ("כביש 90, צומת ..."), industrial zones, and streets absent from
OSM (about 130).

## Other sources evaluated (not shipped)

| Source | Licence | Israel subset | Effect on the 1,163 branches |
|---|---|---|---|
| Overture Maps `addresses` (release 2026-10-21.0) | CDLA-Permissive-2.0 / ODbL parts | **0 rows** inside 34.2,29.4,35.9,33.4 | none: no Israeli coverage |
| Overture Maps `places` | CDLA-Permissive-2.0 (Meta, Microsoft), CC0 (AllThePlaces), Apache-2.0 (Foursquare); attribution to Overture Maps Foundation recommended | 247,916 places, 41 MB parquet; 4.6k grocery/convenience | place whose address equals the branch address: 64 branches (53 of 60 within 1 km), but only 4 of them are ones OSM misses. Brand+city match: 93 of 229 within 1 km (generic names). Not kept |
| CBS street list, data.gov.il resource `9ad3862c-8391-4b2f-84a4-2d4c68625f4b` | published as open data by the Israeli government; the API gives no licence text, so check terms before shipping | 63,662 rows (locality code, street code, name), no coordinates | the street exists in the list for only 32 of the 346 offline misses, and a name without coordinates cannot be located. No coverage gain; useful only as a spelling dictionary |
| OSM `shop=supermarket/convenience` POIs (same PBF, ODbL) | ODbL | 1,549 brand POIs in the index (+~0.1 MB) | `LookupBranch` matched 223 branches but only 91 of 153 (59.5%) within 1 km of the online result (OSM has few branches per chain, ambiguous or missing). Reported, not used by `Lookup` |
| Survey of Israel / GovMap open address data | not evaluated: no openly downloadable dataset with coordinates found without an API key | | |

## Known limitations

* House-number coverage is OSM's (160k addresses, many cities sparse): interpolation and
  "nearest number" are estimates; on long streets (Jabotinsky) the street point can be
  several km from the branch. 6% of hits disagree with the online result by more than 1 km,
  mostly long streets and same-named streets in one city.
* Names without Hebrew letters (Arabic-only villages) are not indexed as streets.
* Not yet integrated into `core/geocode.go`.
* `osmindex` imports `paulmach/osm` (pure Go zlib unless cgo is on); the phone-app package
  should only import the query side if build size matters (`Load`/`Lookup` do not use it,
  but Go links the package as a whole).
