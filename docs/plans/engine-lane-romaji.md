# Engine lane (Codex / GPT-5.5) — Bilingual romaji data pipeline

**Owner:** engine lane. **Touches:** `pipeline/`, `data/readings/`, `public/rail/jp-2025.json`, golden tests.
**Does NOT touch:** `src/` (app/UI) or `src/contract/types.ts` (steering bumps the contract; you code against the fields below).

## Goal
Add accurate romaji readings to the JP RailGeoPackage so the app can show bilingual
(romaji + 日本語) station/line names and bilingual search. Source = OpenStreetMap +
Wikidata + manual overrides, joined offline and deterministically. Target ≥97% station
coverage with the irregular readings correct (日暮里=Nippori, not a kanji→romaji guess).

## Shared contract (already bumped by steering — code against these)
```ts
interface RailStation { …; nameRoma?: string; romaSource?: 'osm' | 'wikidata' | 'manual'; }
interface RailLine    { …; nameRoma?: string; }
```

## Why these sources (measured during planning)
- N02 = 9,046 station groups (N02_005g), 8,503 distinct JP names, 425 names repeat across
  locations (神戸 = Kobe / Godo / Kambe — three readings) → **join MUST be name + nearest-coord, never name alone.**
- OSM `railway=station` `name:en` = 98.7% tagged; bare JP `name` matches N02 directly;
  measured name+coord≤700m join = **94.0%** of groups. License ODbL.
- Wikidata SPARQL English label ("X Station", CC0) fills the gap → **~97-99%** combined.
- kuroshiro/kuromoji/wanakana are NOT viable as a source (mis-read place names); fallback-only.

## Tasks

### E1 — `pipeline/build-readings.ts` (fetch + join)
- **Fetch (a separate `--refresh` step, cached + committed — normal builds read the cache):**
  - OSM via Overpass: `[out:json][timeout:120]; area["ISO3166-1"="JP"][admin_level=2]->.jp; node["railway"="station"](area.jp); out tags center;`
    — **use `out tags center;` NOT `out tags;`** (the latter drops lat/lon → join silently returns 0). Cache → `data/readings/osm-stations.json` (committed). Keep name, name:en, name:ja-Latn, name:ja_rm, lat, lon.
  - Wikidata SPARQL: `?s wdt:P31/wdt:P279* wd:Q55488 ; wdt:P17 wd:Q17 ; rdfs:label ?en (FILTER lang='en') ; wdt:P625 ?coord`. Cache → `data/readings/wikidata-stations.json` (committed). Strip ` Station` from label.
- **Join (offline, deterministic):** group N02 stations by N02_005g; representative = N02_005 name + centroid of `display_point` coords ([lon,lat] — do NOT swap). Per group:
  - Tier 1: exact bare-name match to OSM `name`, pick nearest OSM node, accept if ≤700m → romaji = name:en || name:ja-Latn || name:ja_rm. `romaSource='osm'`.
  - Tier 2 (still unmatched): nearest OSM node ≤250m ignoring name. `romaSource='osm'` (flag for review).
  - Wikidata fill (still unmatched): strip `駅` from N02 name, match Wikidata label+coord ≤700m. `romaSource='wikidata'`.
  - Overrides last: `overrides/jp-n02-overrides.json` keyed by N02_005g. `romaSource='manual'`.
- **Output** `data/readings/station-readings.json` = `{ [n02_005g]: { romaji, source } }` (committed). Normalize romaji display (Title-case, keep hyphens; strip macrons for the search-normalized form the app builds). Also produce line readings `{ [op+line]: romaji }` (山手線→"Yamanote Line") from OSM/Wikidata line names or a small curated table.

### E2 — join into `pipeline/n02-ingest.ts` + rebuild
- Load `station-readings.json` + line readings; pass via `IngestOptions`. In `buildLine()` set
  `station.nameRoma` (lookup by `s.id` = N02_005g) + `romaSource`; set `line.nameRoma`.
  Missing reading → leave `undefined` (no crash). `build-jp.ts` loads + passes the readings.
  Rebuild `public/rail/jp-2025.json`.

### E3 — romaji gate in `pipeline/verify-jp.ts` (already in `npm test`)
- Coverage floor: ≥97% of stations have `nameRoma`; fail below.
- Golden irregular set (must match exactly): 日暮里→Nippori, 放出→Hanaten, 我孫子→Abiko,
  御徒町→Okachimachi, 雑司が谷→Zoshigaya, and the three 神戸 (Kobe/Godo/Kambe — assert by coord/lineId).

### E4 — `tests/geometry/*.test.ts` (node --test) for the join
- Exact-name match; nearest-coord pick; 神戸×3 coord disambiguation; `駅`-strip for Wikidata;
  override precedence; Tier-2 spatial-only path. Pure-function tests on small synthetic inputs.

### E5 — residual review
- Dump the ~600 low-confidence (Tier-2 / Wikidata / unmatched) rows to a review file; eyeball,
  add `overrides/jp-n02-overrides.json` entries for any wrong/blank ones, re-run.

## Attribution
`station-readings.json` carries OSM `name:en` → the **rail-data** attribution (not just basemap)
needs the OSM/ODbL credit. Emit the exact credit string for the experience lane to surface in the
map credit (`src/lib/map/style.ts:17`): `Romanizations © OpenStreetMap contributors, ODbL`.
Ship `station-readings.json` itself under ODbL (share-alike binds the table, not the app).

## Done when
Package rebuilt, ≥97% `nameRoma`, golden gate + `npm test` green, residual reviewed, OSM credit string handed off.
