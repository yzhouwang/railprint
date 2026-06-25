# Changelog

All notable changes to RailPrint are documented here.

## [0.7.0.0] - 2026-06-25

### Added
- **Record a ride that spans more than one line.** A through-service like 特急ひのとり (津 → 大阪難波, which runs 近鉄名古屋線 → 大阪線 → 難波線) used to be impossible to log — marking only worked when both stations sat on the same line. Now, when you search two stations by name, the app finds the actual route(s) between them across the whole network and offers them in a route-picker: each candidate shows its line sequence (名古屋線 › 大阪線 › 難波線), distance, and number of lines, with the most direct route suggested first. Pick the one you rode and every leg lights at once, recorded as a single trip. If the two stations have no rail path between them, you get a clear message plus a one-tap "record each segment separately" fallback instead of a dead end.

### Changed
- Station-search marking is now route-based: a single-line ride is just the simplest (zero-change) route, so the route-picker also subsumes the old "which of these shared lines?" prompt. Tap-the-map marking is unchanged (pick a line, tap two stations). A route on the line you actually searched is always offered first, so a parallel Shinkansen between the same two stations can't get recorded by accident (and silently inflate your HSR %).
- Contract: `RouteCandidate`.

### Internal
- New `route.ts`: a runtime graph (per-line station instances; segment edges weighted by km + zero-cost transfer edges between same-station-group instances) with Yen's k-shortest-paths over a lexicographic (line-changes, then km) cost, memoized per data package, with caps so a cross-country pair can't stall the UI. A whole route is recorded as one trip; re-marking a journey re-groups its already-ridden legs into the new trip by updating them in place — never duplicating the durable log. A Playwright/SwiftShader e2e drives the full search → route-picker → record flow.

## [0.6.1.0] - 2026-06-25

### Fixed
- **A fast double-tap could log the same ride twice.** When the same segment was marked from two near-simultaneous taps, both reads of the ride log happened before either save, so the segment landed in the durable log twice under two trip ids — bloating per-event stats (most-ridden line, ride history) and the CSV backup. Your coverage % was always correct (it's set-based); only the underlying log was affected. The mark now writes through one atomic IndexedDB transaction, so a concurrent or repeat mark of an already-ridden segment is a clean no-op — and the km toast counts only what was actually newly recorded.

### Internal
- **The zoom-tiered map is now tested headlessly.** A Playwright + Chromium/SwiftShader end-to-end harness drives the real WebGL map and asserts the zoom level-of-detail: at the national view only the Shinkansen spine and your ridden lines show; urban lines reveal as you zoom into a city; and your ridden lines stay visible at every zoom. The map exposes a `window.__map` handle only under a `?e2e` URL flag (inert for real users, verified by a test). This closes a QA gap where map behaviour could previously only be checked by hand.
- Added a JR-Central 東海道新幹線 logo-family golden to the build gate; widened ride-log test coverage (atomic dedup, partial overlap, concurrent marks).

## [0.6.0.0] - 2026-06-25

### Added
- **The map reveals lines by zoom.** Zoomed out to all of Japan you see the Shinkansen spine and major trunk lines; zoom toward a city and the urban lines (山手線, subways, major private) appear; zoom in close and every local line, tram, and cable car fills in. Each line carries a tier (`RailLine.rank` 0–4, computed from its type), so the national view is legible instead of a 594-line hairball. Your **ridden** lines and any **selected** line stay visible at every zoom — your network never vanishes when you zoom out.
- **Station dots reveal by spacing, not just by line.** A dense line (山手線, subways ~1 km apart) draws as a clean stroke and only sprouts its ~30 dots once you're zoomed in enough that they're not cramped, while sparse Shinkansen/rural stations show with their line. Each line's reveal zoom is derived from its average inter-station distance; a non-loop line's two termini anchor with the line so you always see where it starts and ends.

### Changed
- Line + station visibility is one MapLibre filter (`zoom ≥ tier OR ridden OR selected`) on the existing layers — no extra layers, no double-draw.
- Contract: `RailLine.rank`.

### Performance
- The per-repaint station-adjacency rebuild (a 9,442-entry map rebuilt up to 48× during an import flood) is now memoized by package identity — closing the deferred P1 render-perf landmine. Zoom LOD also cuts the rendered-feature count at low zoom.

## [0.5.0.0] - 2026-06-25

### Added
- **Every line in its official color.** The map now draws each line in its real color (山手線 yellow-green #9ACD32, 大阪環状線 red, 東海道新幹線 blue…) instead of one emerald monochrome — 594/594 lines colored (≈300 sourced from Wikidata, the rest an operator-default brand color). Ridden lines saturate, thicken, and glow in their own color; unridden lines show the color faded — so completion still reads, now in full color.
- **Hover a station to see its lines.** A hover popup lists every line through a station, each with its color swatch, its **logo** (227 lines have one, from Wikimedia Commons), and the bilingual name. Logos also appear in the line picker, search results, and the selection panel.
- **Line logos, now on 349 lines (38% → 59%).** A 307-line audit checked every still-logoless line against Wikidata + ja-Wikipedia. Two fixes recovered ~120 logos already on disk (an operator-aware, src-keyed join — a JR-East line never gets a JR-West badge) and backfilled 62 more from systematic line symbols (JR Kyushu `JA/JD/JJ…`, Keihan `KH`, Shinkansen marks) + 3rd-sector company logomarks. The remaining gap is lines that genuinely have no official symbol (trams, cable cars, most rural branches).
- **The railway company beside each line.** Every line now shows its operator as a muted grey label to the left of the logo and name (`JR東日本 [JY] 山手線`), everywhere a line is named — picker, selection, search, and the hover popup. De-duped when the line name already carries the brand.

### Changed
- The selected line now reads via a dark casing under it (the old red highlight collided with the new line colors). Station dots became a neutral ridden/unridden channel. The app's emerald brand (header, stats, Wrapped cards) is unchanged — only the map is multicolor.
- Contract: `RailLine.color` / `RailLine.logo` / `RailLine.operator`. Rail-data credit now also attributes Wikimedia Commons for the logos.

### Fixed
- Lines that share a name across operators no longer get the wrong color/reading: 山手線 (JR East) and 山手線 (神戸市) are distinct, 中央線 (JR East) ≠ 中央線 (Osaka Metro). The same operator-aware join fixed the line-romaji mismatch.

## [0.4.0.0] - 2026-06-24

### Added
- **Bilingual station names (romaji + 日本語).** Every station carries a romaji reading — 97.6% of ~10,000 stations — from OpenStreetMap + Wikidata, joined by Japanese name + nearest coordinate so the irregular readings come out right (日暮里 = Nippori, 放出 = Hanaten, and the three 神戸 = Kobe / Godo / Kambe told apart by location). A golden gate enforces ≥97% coverage and the known-hard readings as part of `npm test`.
- **Record a ride by typing a station, not just tapping.** Search any station by 日本語, romaji, or かな (新宿 / Shinjuku / しんじゅく all resolve), pick from transfer-station matches (渋谷 lists all 7 of its lines), and the line linking your two stations is inferred automatically — with a small picker when they share more than one line, and a clear message when they share none.
- **The selected line highlights in red** while you record, so it's obvious which line you're marking; the line's stations light up too. A hover/tap popup shows a station's name in both scripts.
- Romaji line names where available (山手線 → Yamanote Line).

### Changed
- Contract gained optional `nameRoma` / `romaSource` on stations and `nameRoma` on lines; the rail-data map credit now also attributes OpenStreetMap (ODbL) for the romanizations.

## [0.3.0.0] - 2026-06-24

### Added
- The real Japanese national rail network on the map: **594 lines, ~10,000 stations, ~26,800 km**, built from the official MLIT N02 dataset — replacing the old 5-line placeholder. Every Shinkansen matches its published 営業キロ to within 0.2% (東海道 515, 東北 675, 山陽 553…), and loops like 大阪環状線 render as proper rings.
- The build pipeline behind it: it groups track by operator + line name (so the JR-East 山手線 and the Kobe-subway 山手線 stay separate lines), rides one track of double-track lines so distances aren't doubled, tells real loops from out-and-backs, orders stations along each line, and bridges small gaps in the source data. A golden gate verifies the output against known line lengths and runs as part of `npm test`.
- A `fetch-n02` script and pipeline README so the network can be regenerated from source, plus a visible map credit for the rail data (CC BY 4.0).

### Changed
- First open now loads the real network with a brief loading screen. If the data can't be reached, the app falls back to a starter map and automatically retries when you reconnect or return to the tab — and shows a "data unavailable, retrying" banner instead of silently reading your rides as 0%.

### Fixed
- Transfer stations shared by several lines (新宿, etc.) keep their correct position on each line instead of collapsing onto one platform.
- Lines that pass close to themselves (大江戸線, 鶴見線, 京葉線) no longer report nonsense ~60 m gaps between stations that are actually over a kilometre apart.
- Trunk lines that span a data gap (山陽線, 日豊線, 常磐線) now show their full length and station list instead of just the largest connected piece.

## [0.2.0.0] - 2026-06-23

### Added
- The experience app: a Svelte UI on the shared contract + the JR-East emerald design system. A tile-free MapLibre map with ridden segments lit emerald, line-first marking (pick a line → tap A → tap B), stats, CSV import with review-and-resolve, Wrapped-style cards, a Dexie store + pure resolver (coverage-set + ride-events), CSV export, trips, train-model collection, and an offline overlay. 111 app tests.
- A dev-only demo seed so the local preview shows the flex (a glowing 山手線 loop + a real completion %) instead of a blank map.

### Fixed
- `markRide` no longer re-stamps already-ridden segments on a partial-overlap re-mark — it had persisted the whole A→B slice, bloating the durable ride-event log and corrupting per-event stats (most-ridden line, ride history). Now persists only newly-lit segments; regression test added.

### Changed
- Both build lanes are merged onto `master`: the engine geometry pipeline + the experience app on one shared `RailGeoPackage` contract. `build` runs svelte-check then vite; `test` runs both the geometry (node:test) and app (vitest) suites.

## [0.1.0.0] - 2026-06-23

### Added
- Rail-geometry build pipeline: stitches MLIT N02 RailroadSection features into one ordered, direction-consistent polyline per line, derives Shinkansen station order by projection, and emits a versioned RailGeoPackage with per-inter-station km, canonical segment ids, and HSR classification (keyed off N02_002).
- Golden-file geometry test suite that verifies km against known great-circle distances, station counts, loop arcs, and fail-closed behaviour (13 cases).
- Shared cross-lane contract (`src/contract/types.ts`) and the emerald design-token system; browser app scaffold (Vite + Svelte) with a placeholder entry.
- Two-agent orchestration plan: GPT-5.5 engine lane + Opus 4.8 experience lane, with the `RailGeoPackage` as the single cross-lane boundary.

### Fixed
- Loop lines whose station order opposes the stitched winding no longer inflate segment km ~3×: the pipeline reverses the geometry to measure the short arc, or fails closed.

### Changed
- Stations are validated before a line ships: fail closed when a station projects more than 2 km from its own line (wrong-line/bad geocode), when station seq or ids duplicate (segment-id collision), or when a line has too few stations for coverage.
- Endpoint stitching clusters near-miss section endpoints within a tolerance instead of exact string matching, so real-world N02/OSM endpoints snap together.
- Loop arc direction is derived from the actual stitched winding instead of copied from input.
