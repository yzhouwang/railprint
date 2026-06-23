# Changelog

All notable changes to RailPrint are documented here.

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
