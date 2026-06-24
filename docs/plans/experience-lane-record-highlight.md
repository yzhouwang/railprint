# Experience lane (Claude / Opus 4.8) — Record-add: red highlight + bilingual station-first search

**Owner:** experience lane. **Touches:** `src/` (map, store, screens, search, tests).
**Does NOT touch:** `pipeline/` or `src/contract/types.ts` (steering bumps the contract; you consume the fields).
**Consumes:** the engine lane's rebuilt `public/rail/jp-2025.json` with `nameRoma`/`romaSource`. C1 (highlight)
has NO romaji dependency and can start immediately; C2–C5 integrate once the package lands (or against a small `nameRoma` stub).

## Goal
When the user records a ride: highlight the selected line RED, and let them record either by
tapping the map (exists today) OR by typing station names (new, station-first, bilingual). Show
bilingual names (romaji + 日本語) wherever a name is read/typed, plus an on-map hover/selection popup.

## Shared contract (bumped by steering — consume these)
`RailStation.nameRoma?: string`, `RailStation.romaSource?`, `RailLine.nameRoma?: string`.

## What already exists (reuse, don't rebuild)
- Full mark flow: FAB → `markMode` → line-picker → `onStationTap` → `doMark` → `markRide` → `segmentsBetween` → persist + `pulse()` glow (`src/screens/MapView.svelte`). Selection state is component-local `$state` (selectedLine, stationA).
- Fuzzy matching: `src/lib/import/crosswalk.ts` — `normStation`, `diceSimilarity`, `scoreStationCandidates` (pure, tested). Reuse for ranking; do NOT duplicate the OLD_TO_NEW kanji table.
- Paint pattern: `repaint()`/`setPaintProperty` in MapView; `isLit` expression in `style.ts`. NO `setFeatureState` (design rule — keep it).

## Tasks

### C1 — Red highlight (`src/lib/map/style.ts` + `src/screens/MapView.svelte`)
- Add `selectedLineSegmentIds(line, packages)` + `selectedLineStationIds(line)` helpers (mirror `litStationIds`).
- Add a dedicated **red highlight line layer** (`rp-segments-highlight`) ABOVE `SEGMENTS_LAYER` and a red station
  layer, each with `filter ['in', ['get','segmentId'/'stationId'], ['literal', selectedIds]]`.
- MapView: `$effect` on `selectedLine` → compute ids → `map.setFilter(highlightLayer, …)`; clear on deselect.
- **Red wins over emerald** (selection is transient): highlight layer paints above the ridden/unridden base; suppress emerald glow under the highlight. Do not mutate the base ridden/unridden expressions.
- Tests: `style.test.ts` — the no-glyphs/sprite assertion must still pass; new: highlight filter built correctly, selected line's stations included.

### C2 — Bilingual search index (`src/lib/search.ts` + `src/lib/store.ts` geo index)
- Geo index: add `stationGroupById: Map<stationGroupId, {lineId, stationId}[]>` and a boot-time
  bilingual index keyed on BOTH `normStation(name)` and the normalized romaji (lowercase, strip
  macrons/hyphens) → candidate stations.
- `src/lib/search.ts`: search wrapper that reuses `normStation`/`diceSimilarity`; **exact-match first**,
  returns ALL candidates (no 5-cap — 住吉 appears 10×); `wanakana` (lazy-loaded) normalizes typed input
  (しんじゅく / shinjuku / 新宿 all resolve). ~3% stations lack `nameRoma` → searchable by JP name only (acceptable).
- Tests: "shinjuku"/しんじゅく/新宿 → 新宿; 住吉 returns all 10; transfer 新宿 returns its 7 line-instances.

### C3 — Line inference (`src/lib/search.ts`)
- Given resolved A and B (each → `stationGroupId`), intersect the lines containing BOTH groups
  (via `stationGroupById`). Same-line → use it; multi-share (盛岡-仙台 on 東北新幹線+東北線) → return the
  shared-line candidates for a picker; no-share → typed error ("同じ路線にありません — record each leg separately").
  Validate `segmentsBetween` succeeds for each candidate before offering it.
- Tests: 1 shared line; multi-share returns N candidates; no-share rejects.

### C4 — Wire station-first entry into the mark-panel (`src/screens/MapView.svelte`)
- Add a search text input in the mark-panel as an alternative to tapping: type A → resolve
  (disambiguate transfer via a small list) → type B → infer line (disambiguate multi-share) → `doMark`.
  Reuse `doMark`/`markRide` unchanged. Setting the inferred/selected line fires C1's red highlight.

### C5 — Hover/selection bilingual popup (`src/screens/MapView.svelte`)
- On station hover/click, show an HTML popup (MapLibre `Popup` / DOM overlay — NO glyph layer) with
  `name`（日本語）+ `nameRoma`. Keeps the no-glyphs design.

### C6 — Tests
- Unit (C1–C3) + Playwright E2E for the 3 flows: pick line → red → tap A,B; type "Shibuya" → infer → type "Shinjuku" → recorded; type 新宿 (7 lines) → disambiguation.

## Display + attribution
- Bilingual display pattern `新宿 (Shinjuku)` in search results, selection panel, recorded toast, popup.
- Surface the engine lane's OSM credit in the map credit (`style.ts:17`): append `Romanizations © OpenStreetMap contributors, ODbL`.

## Done when
Highlight works, station-first bilingual search + inference works (with disambiguation + reject), popup works, `npm test` green, E2E green.
