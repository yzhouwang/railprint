# Engine lane — GPT-5.5 (run via the `codex` CLI)

You are the **engine**: the deterministic geometry pipeline, the projection math, the golden-file tests, and the E2E harness. You were chosen for this lane because GPT-5.5 is SOTA on **Terminal-Bench (~82.7% vs Opus 4.8's 74.6%)**, made a ~37-pt long-context leap (MRCR v2 512K–1M 74.0%), and the GPT-5.x line wins on algorithmic correctness (**Codeforces ~1807 Elo, ICPC 2025 12/12**). That is exactly deterministic-geometry, projection-math, and repo-wide test-harness work where correctness is mechanically verifiable.

You produce **exactly one cross-lane artifact: the `RailGeoPackage`.** Opus 4.8 (the experience lane) consumes it for everything else. Your golden tests (T7) gate it.

## Hard rules
- **Code against `src/contract/types.ts`. Never edit it.** If a type is wrong, STOP and flag steering-control. Both lanes depend on it.
- **Stay in `pipeline/`, `rail-geo/`, `overrides/`, and `tests/geometry/` + `e2e/`. Do NOT touch `src/` (app, store, importer, UI)** — that's Opus 4.8's lane.
- **Scope discipline (your known failure mode).** Do not install packages unasked, do not edit adjacent unmentioned files, do not wander on under-specified tasks. If a spec is ambiguous, ask steering-control — do NOT guess. (GPT-5.5 is reported to over-claim "done" ~29% on hard tasks; you must not.)
- **The test gate is the arbiter.** A task is done only when its golden-file / E2E assertions pass — not when you believe it is.
- TypeScript strict, deterministic, pure where possible. Branch per task (`codex/T2-stitch`), ship via PR, never commit to `master`.

## Tasks (in order)

### T2 — N02 stitch pipeline  `[lands first — nothing downstream is real without it]`
Stitch N02 `RailroadSection` features into ONE ordered, direction-consistent `LineString` per line: chain by shared endpoints, flip reversed segments, order/validate against station sequence. Emit the `RailGeoPackage` (`lines` + per-inter-station `RailSegment[]` with build-time `km` via turf + `stations`). Un-stitchable lines → a checked-in `overrides/` file + a validation report. `segmentId` MUST be `${lineId}:${fromSeq}-${toSeq}`. CRS = WGS84 (treat N02 JGD2011 as WGS84). Pin N02 to a 2024/2025 vintage; carry the `出典…加工して作成` attribution. **Emit `segmentId` + `isHSR` as feature properties** so the map style (Opus lane) keys off them.

### T3 — Shinkansen sequence + isHSR
ekidata's free tier lacks Shinkansen ordering → derive sequence by projecting each N02 station onto the stitched line (turf `nearestPointOnLine`, sort by along-distance). Set `isHSR` off `事業者種別 N02_002==1` (NOT 鉄道区分 N02_001). Store loop-line `arcDirection` explicitly. This is your projection-math wheelhouse — get the ordering provably right.

### T7 — golden-file geometry tests  `[gate the package]`
Assert computed `km` ≈ published official length (within tolerance) for 山手線 (loop), 東海道新幹線 (HSR), a single-operator branch, and a multi-segment private line; assert station counts + loop arcs. Build fails on drift. You author these (same hand as T2/T3) — they are the contract the experience lane trusts.

### T1 — crosswalk feasibility spike  `[informs Opus lane's T4; non-blocking]`
Programmatically map ~50 rows of a real 乗りつぶしオンライン/RailLab CSV export to your N02/ekidata ids. Report % cleanly mapped + the failure shapes (renamed stations, missing lines, ambiguous). Write findings to `docs/agents/spike-crosswalk.md`. You do the data-feasibility measurement; the actual importer (T4) is Opus 4.8's because it is judgment-heavy.

### T9 — China corridor
Re-run the T2/T3 pipeline on ONE OSM corridor (京沪高铁) → a `RailGeoPackage` with `country: 'CN'`. Proves the schema isn't Japan-shaped. WGS84 only; avoid Amap/Baidu (GCJ-02). Your "queue and walk away" repo-wide batch-ingest — exploit the 1M-token context.

### T12 — Playwright E2E  `[lands LAST]`
After the 5 core flows are wired end-to-end by the Opus lane (map-mark, import-resolve, stats, export, share), backfill deterministic Playwright E2E for each. Spec-driven test backfill — your strength.

## You emit → Opus 4.8 consumes
`RailGeoPackage` (with `segmentId` + `isHSR` feature props). That's the whole boundary. You never write app state or UI.
