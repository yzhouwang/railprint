# Changelog

All notable changes to RailPrint are documented here.

## [0.10.1.0] - 2026-07-02

Architecture hardening (post-railnet-split review). No user-facing feature change; internal
structure, test coverage, and CI.

### Added
- **CI now runs the Playwright e2e suite** (`.github/workflows/ci.yml`) in a parallel job — the
  `MapView` map is dynamically-imported WebGL, unreachable by vitest, so the e2e suite is its only
  coverage and CI never ran it. A map regression now fails CI. npm is cached on both jobs. (The two
  offline service-worker specs are excluded on CI — they're timing-sensitive on the cold SwiftShader
  runner; they still run via `npm run test:e2e` locally. Tracked for a follow-up.)
- **`src/lib/marking.ts` + 9 unit tests.** The search-mode route inference (the latest-wins resolve
  guard, the same-station guard, and the no-route/single/multi route classification) was reachable
  only through Playwright; the pure decision logic is now extracted and unit-tested.

### Changed
- **`src/lib/geo-index.ts` extracted from the store.** `GeoIndex`/`buildGeoIndex`/`groupKeyOf` lived
  in the stateful `store.ts`, so pure consumers (search, map/popup, export, wrapped/card)
  value-imported the whole fetch/Dexie/fallback module graph. They now import a framework-free
  module; `store.ts` re-exports the symbols so nothing else changed.
- **`src/fixtures/stubPackage.ts` → `src/lib/fallback-package.ts`.** It ships in the production bundle
  as the degraded-mode fallback, so it now lives in `lib/` with a header that says so (its old header
  claimed it "never runs at app runtime").
- **`MapView.svelte` decomposed:** the maplibre handles are typed (no more `any`), and the `?e2e` QA
  hook moved to `src/lib/map/e2e.ts` (the `window.__map`/`__mapReady` contract is byte-for-byte
  preserved — all e2e specs pass unchanged).

### Fixed
- **Boot opens the durable IndexedDB store before the network package fetch.** `init()` ran the slow
  8.8 MB package fetch first and only opened Dexie afterward, so in a cold/slow environment the object
  stores were created late — anything reading the DB in that window found no `rideEvents` store. It
  now opens the store first, so it's ready independent of network speed (surfaced by the new CI e2e
  job, whose cold fetch reproduced the race the fast local server hid).

### Removed
- Dropped the unused `pmtiles` dependency (+ its `assetsInclude` entry) — it was never imported.
  Git history re-adds it when the vector-tile geometry work lands.

## [0.10.0.1] - 2026-06-27

Extracted the rail-geo data + build into a standalone package, **railnet**. No runtime change.

### Changed
- **rail-geo is now its own package.** The build pipeline, the MLIT N02 / OSM / Wikimedia sources, and the released artifacts moved out of this repo into a standalone, independently-versioned **railnet** repo. RailPrint is now a consumer: it pins a railnet version (`railnet.json`), vendors the built artifacts (`public/rail/` stays committed), and the contract is shared via `src/contract/rail-package.ts` (synced from railnet). Runtime is **unchanged** — same-origin, so offline + SHA-256 + the service worker all keep working; the boundary is now versioned + compile-checkable instead of a runtime skew. `npm run sync:railnet` re-vendors + re-verifies; `npm run verify:rail` (in CI) checks the vendored artifacts against their own manifest SHA-256.

### Fixed (de-risk, from a readiness audit + a 6-agent verification workflow)
- The integrity **manifest is now a typed, shared contract** (`RailManifest`) with explicit `MANIFEST_SCHEMA_VERSION`; the store **rejects a manifest whose schema is newer than it understands** (was hand-duplicated producer/consumer — a silent-skew trap). The split's boundary was independently verified skew-safe: coverage math ignores `railGeoVersion`, the old/new segment IDs are 100% disjoint, and every drop-out surfaces as a warning, never silent.
- The map's rail attribution is single-sourced from the contract (it had drifted from the pipeline's).
- **Declared `@types/node` as a devDependency.** Two test files read the vendored `public/rail/*.json` fixtures via `node:fs`; the type was only ever resolved transitively, so the new CI's clean `npm ci` + `svelte-check` failed to find `node:fs`. Now explicit — a latent gap the CI (added in this release) exposed.

## [0.10.0.0] - 2026-06-27

Rail-geo durability program complete (Phases 0-4): deterministic content-addressed IDs, SHA-256 package integrity, an offline service worker (installable PWA), a chained N→N+2 migration engine, and the quarantine review below. The 0.9.1.0–0.9.2.0 entries are the development increments folded into this milestone.

This release adds **Phase 4 (quarantine):** rides whose track was abolished in a data refresh are no longer silently dropped from coverage — they surface for review and can be kept as closed-line history.

### Added
- **Quarantine review.** When a refresh abolishes the segment a ride was recorded on, the ride becomes an "orphan" (its `segmentId` no longer resolves). Before, it silently vanished from your map. Now a calm **確認待ち** card in 統計 (not the "network failed" banner — the package loaded fine, only one segment is gone) opens a review sheet that **groups orphans by line** with a one-tap すべて廃線として残す. The honest action for abolished track is **keep as a closed line** (廃線として残す): the ride stays as real history and surfaces as a positive **廃線 km** stat, never a coverage deduction. `RideEvent` gains `km` (snapshotted at record time, since an abolished segment's km is otherwise unknowable) + `quarantine`; `orphanGroups` / `orphanCount` / `closedLineKm` are namespace-aware, so a transient package-load failure can never mass-quarantine a log.

### Fixed
- **An all-orphaned log was hidden.** A returning user whose entire log was orphaned (0 resolved km) saw the cold-start empty state instead of the review — orphans hidden exactly when every ride needed them. The stats body and `App` cold-start gate now stay live whenever there are orphans or kept closed-line rides. (Caught by a Codex↔Claude cross-review.)

### How it was built
Two-lane Codex (engine) + Claude (UI), a `/plan-design-review` that took the one-line plan to a full spec, then a Codex↔Claude cross-review (the P1 above + dialog a11y: Escape on `svelte:window`, 44px touch targets, distinct close labels) and /qa. 282 vitest + 41 geometry + 16 e2e (incl. an orphan-only review-reachability test) + svelte-check clean. This release rides on the same PR as Phases 0-3 (re-landing Phase 0 onto master). The package CDN extraction + E1 open ridelog remain, tracked in `docs/designs/rail-geo-durable-package.md`.

## [0.9.2.0] - 2026-06-27

Rail-geo durability, Phases 1-3: the rail data is now integrity-verified, works fully offline, and a returning user's coverage survives multi-version data refreshes.

### Added
- **Package integrity (SHA-256).** The build emits a `manifest.json` (schema v2) carrying a per-file SHA-256 for every rail package and migration map, deterministic across rebuilds. The app now loads packages manifest-driven and verifies the fetched bytes against that digest — a truncated or poisoned package is rejected rather than silently shifting your coverage denominator. A configurable China-reachable secondary origin (`VITE_RAIL_CDN_SECONDARY`) is tried after the primary.
- **Offline support (service worker).** A Workbox service worker precaches the app shell plus all rail data (packages + migration maps, 15 entries / ~11 MB) at one content-revision, so you can open the app and mark a ride with no signal. Manifest and package are cached together, so the integrity check never sees a fresh-manifest / stale-package skew; a within-year data refresh still busts the cache because the cache key is the file's content hash. RailPrint is now an installable PWA (manifest + icon).
- **Chained migration.** The N→N+1 engine is proven to chain N→N+2 (e.g. 2025.1.0 → 2025.2.0 → 2025.3.0): a pinned event walks every step to the current id, `originalSegmentId` preserved as the first-ever id. A missing mid-chain map is all-or-nothing — the event stays at its known-good id and retries, never half-migrated.

### Fixed
- **Boot could hang on a stalled package body.** The cold-start timeout now stays armed through the response body read (`arrayBuffer`/`json`), so a 200 response with a half-delivered 8.8 MB package aborts and degrades instead of freezing the loading screen. (Caught by a Codex↔Claude cross-review.)
- SHA-256 comparison is now case-normalized and format-validated; a malformed manifest digest logs and skips rather than mis-comparing.

### How it was built
Two-lane Codex + Claude (engine + app), a Codex↔Claude cross-review that caught the P1 boot-hang and a weak offline test, then /qa and /ship. 278 vitest (incl. SHA-mismatch + chained-migration + a new **offline-record e2e** that marks a ride with the network cut) + 41 geometry + 14 e2e + deterministic manifest. This PR also re-lands Phase 0 (v0.9.1.0) onto master, which had merged only into an intermediate branch. Remaining: the package CDN extraction + full quarantine UX + the open ridelog spec, tracked in `docs/designs/rail-geo-durable-package.md`.

## [0.9.1.0] - 2026-06-27

Rail-geo durability, Phase 0: rail IDs are now content-addressed and deterministic, and a returning user's saved rides survive a routine data refresh.

### Added
- **Content-addressed JP IDs.** `segmentId` is now `lineId:fromGroup-toGroup` (the endpoints' N02 group codes) instead of positional `fromSeq-toSeq`, and `lineId` drops the build-ORDER `#N` collision suffix for a content hash (only on a real slug clash). IDs no longer drift when the N02 source reorders, so a routine annual refresh can't silently break a user's coverage. Geometry is byte-identical (only the 9,442 IDs changed); rebuild is deterministic.
- **N→N+1 migration engine.** The build ships an old→new `segmentId` map (`public/rail/migrations/jp/<from>-to-<to>.json`) + a `manifest.json`; on a version bump the app re-points a user's pinned events in place — **non-blocking** (after first paint), idempotent, **per-namespace** (JP and CN bump independently), `originalSegmentId` preserved for reversibility, and a fail-safe that leaves events intact + retries online rather than ever locking a user out. `RideEvent` gains `originalSegmentId`.

### How it was built
A full `/plan-ceo-review` + `/plan-eng-review`, a 2-round Codex↔Claude design conversation that locked the ID scheme (hash-on-collision), and a Codex↔Claude cross-review (2 P1 store bugs caught + fixed; the migration map verified a corruption-free 9442/9442 bijection against the shipped package). 274 vitest + 41 geometry + 12 e2e + a version-bump golden test (coverage preserved across a bump). CN stays positional pending its own station-identity scheme; broad China + the package CDN/offline phases remain in `docs/designs/rail-geo-durable-package.md`.

## [0.9.0.2] - 2026-06-26

Hardening pass from a full-codebase audit: close real data-loss and trust holes in shipped code, backfill tests, and polish the rough UX edges.

### Fixed (data-safety & correctness)
- **Import "replace" could wipe the whole ridelog with no confirmation.** Replace mode now routes through an explicit, clearly-destructive confirm step (it names how many records will be deleted) before touching the log. Merge commits straight through.
- **Overlapping imports silently duplicated diary entries.** Imported rows now dedupe against prior imports on (ride date + segmentId), format-agnostic (`2025/6/1` = `2025-06-01`), so re-importing an overlapping export adds nothing — while a manual mark and an import of the same ride stay independent records (append-only; neither silently shadows the other). Undo on an import deletes exactly the rows it wrote (by id), and a replace confirms but offers no undo (it can't restore a wiped log).
- **Cold-start could hang forever on a stalled network.** Package fetches now time out (15s) and degrade to the JP-only fallback + retry instead of freezing the loading screen.
- **Only 43% of lines had English names** despite the reading data being on disk — the build pipeline didn't carry line readings through. Now wired: line romaji coverage 43% → **87%** (515/594).
- **iOS share contract was comment-only.** `shareCard` now guards that it received an eagerly-built non-empty Blob (a spent gesture throws NotAllowedError on iOS Safari otherwise), backed by tests.

### Added (UX)
- Undo on a success toast for both marking a ride and importing ("元に戻す").
- Station search: a "該当する駅が見つかりません" message on no results, and Enter (pick first hit) / Escape (clear/exit) keyboard handling.
- Import: a progress spinner during commit; the export button is disabled (not just toast-on-click) when there are no rides.
- An offline strip on the stats/import screens (previously the offline signal was map-only, so importing offline failed silently).
- A "京沪プレビュー" caption on the China stat card so its % reads as "of the preview corridor", not all-China.

### Tests
- New: `import/parse.test.ts` (fuzzy resolution, +13), `wrapped/share.test.ts` (iOS gesture safety, +9), `pipeline/verify-jp.test.ts` (golden-gate), `e2e/import.spec.ts` (cold-start + replace-confirm), a fetch-timeout boot test, and dedup regression tests in `import/commit.test.ts`. 238 → 269 unit tests; 10 → 12 E2E.

## [0.9.0.1] - 2026-06-26

Release-hardening: make the 0.9.0 claims true everywhere.

### Fixed
- **Mobile showed a blended "全国" card.** The phone map screen still summed Japan + China into one misleading "% national". All three stat surfaces (desktop side panel, mobile map, 統計) now share one `CountryStatCards` component, so they can't drift apart again — Japan's % is Japan's alone.
- **The China corridor was buried under 594 JP lines.** The line picker gains a 日本 / 中国 country filter (Japan-first default) so 京沪高速铁路 is one tap away.
- **Package integrity:** the loader rejects a wrong-country payload (a CN url serving a JP package never loads as CN), and there is no fake-CN fallback — if the corridor fails to load, the app runs Japan-only and flags saved China rides as degraded rather than stranding them silently.
- Version files reconciled (VERSION + package.json + package-lock.json all at 0.9.0.1; the lock had lagged at 0.6.1.0).

### Internal
- A real-user China E2E (mark mode → search 北京南 → 上海虹桥 → record with a train model → 中国 stats + the model in the diary), plus mobile per-country and line-picker-filter E2Es; the direct-seed test stays as a render smoke test. Boot tests cover the wrong-country rejection and the no-fake-CN fallback.

## [0.9.0.0] - 2026-06-25

### Added
- **The first China corridor: 京沪高速铁路 (Beijing–Shanghai HSR).** RailPrint now loads one real China line alongside Japan — proving the network model is country-agnostic, not Japan-shaped. It draws in CR red, is markable, and counts toward a separate 中国 coverage figure. Built from a curated, checked-in WGS-84 station extract (no GCJ-02, no Amap/Baidu); the geometry is a station-sequence polyline today, to be refined with OpenStreetMap track ways (ODbL) later.

### Changed
- **Stats are per-country now, never blended.** Loading China alongside Japan no longer turns "全国 %" into a misleading "% of Japan + China" — the headline %, the desktop side panel, and the Wrapped card all show Japan's figure on its own, and a separate 中国 card appears once you've ridden in China. Distance and prefecture totals stay cross-country sums.
- **Boot loads both networks independently.** Japan is required (its failure still falls back to the offline sample); the China corridor is additive, so if it can't load you get Japan on its own rather than a broken map.

## [0.8.0.0] - 2026-06-25

### Added
- **旅の記録 — a trip diary on 統計.** Your marked rides now read as a list of journeys: each row shows the date, the route across lines (e.g. 津 → 大阪難波), distance, line(s), and any train model. Rows are date-led, so the same journey ridden twice reads as two distinct dated trips, not a duplicate.
- **Train-model capture.** An optional 車両 field in the mark flow (with recent + known-model chips) records what you rode (N700S, CR400AF, …), canonicalized so N700S / N700s / N700S系 collapse to one model. It surfaces on the diary row and round-trips through CSV export/import.

### Changed
- **The ride log is now an append-only journey log.** Marking a segment or route you've already ridden records it as a *new* trip (a soft "もう一度記録" rather than the old hard block), so repeat rides and per-ride train models are kept faithfully. Coverage %/km are unchanged — they still derive from the deduped set of ridden segments, so a repeat ride never inflates the map.

## [0.7.0.1] - 2026-06-25

### Fixed
- **Typing a station name no longer auto-selects mid-type.** When a partial query resolved to a single station, the search locked onto it immediately — so typing toward "Nagoya" got grabbed at "nago" (and a short name can be a complete match for one station yet a prefix of the one you want, e.g. 名郷 vs 名古屋). Search now always shows the match(es) as tappable suggestions and selects only when you tap.

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
