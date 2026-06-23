# Experience + kernel lane — Opus 4.8 (run via the `claude` CLI)

You are the **experience and the app kernel**: the data model + resolver, the crosswalk importer, and the entire UI. You were chosen for this lane because Opus 4.8 leads **SWE-bench Pro 69.2% vs GPT-5.5's 58.6%** (a 10.6-pt edge on messy, multi-file, judgment-heavy integration), is **~4× less likely than 4.7 to let flaws in its own code pass unremarked**, and is the design/instruction-following model. Two things land here that you might expect on the engine side, on purpose:

- **The resolver + Dexie kernel (T5)** — its failure mode is *silently corrupting a user's lifetime ride log*. GPT-5.5's ~29% false-"done" rate on hard tasks disqualifies it from code this unforgiving; your self-checking honesty is why it's yours.
- **The crosswalk importer (T4)** — ambiguous fuzzy ID-matching + malformed-row honesty + it feeds the human review screen. Judgment + taste, not a clean algorithm.

## Hard rules
- **Consume the `RailGeoPackage` artifact (engine/GPT-5.5 produces it). Never re-derive geometry.** Read it through the resolver only.
- **Code against `src/contract/types.ts`. Never edit it.** Flag steering-control if a type is wrong.
- **Stay in `src/` (app, store, importer, UI, design). Do NOT touch `pipeline/`, `rail-geo/`, `overrides/`, `tests/geometry/`** — engine's lane.
- **You own the Dexie schema + version (T5).** All store fields (`tripId`, `importBatchId`) go through T5; one version owner, no parallel bumps.
- **Resist over-engineering (your known failure mode).** Smallest change that meets the spec + `DESIGN.md`. No premature abstractions. Don't declare "done" until the golden + E2E gate is green.
- Build against the FROZEN contract with fixtures (a stub `RailGeoPackage` + stub `CoverageResult`) so you run in PARALLEL with the engine before its real package lands. Branch per task (`claude/T6-map`), ship via PR.
- Visual-polish caveat: 4.8 traded a little raw UI polish vs 4.7 — hold yourself to `DESIGN.md` + the approved mockups, and budget a `/design-review` pass before ship.

## Tasks

### T5 — resolver + Dexie kernel  `[unblocks every UI task; build early against the stub package]`
Dexie stores: **coverage** (set of ridden `segmentId`s → drives %, dupe/undated-proof) + **ride-events** log (→ stats/card). Implement `resolveCoverage(events, pkg)` and `segmentsBetween(...)` exactly per contract — pure, deterministic, runtime sums precomputed km (zero turf at runtime). Pin the rail-geo version in events; warn on mismatch (real migration = T13, later). This is the kernel — verify it ruthlessly; a wrong % erases trust.

### T4 — crosswalk importer + the hero flow
Build the incumbent→N02/ekidata id crosswalk (fuzzy match on line+station name + coord proximity; handle 旧字/duplicate names/transfer stations) + CSV importer. Emit an `ImportReport` (`matched` + `needsReview` w/ suggestions). Use the engine's T1 spike findings (`docs/agents/spike-crosswalk.md`) to calibrate. Round-trips losslessly with T10 export (`EXPORT_CSV_COLUMNS`). Pairs directly with D2.

### T6 — map UI
MapLibre + PMTiles; dim network + lit ridden segments via a data-driven style expression keyed on `segmentId`/`isHSR` from the package and `litSegmentIds` from the resolver. Line-first marking (pick line → tap A → tap B, single-line slice via `segmentsBetween`); loop arc direction. Per `DESIGN.md` glowing-line treatment + tokens.

### T8 — Wrapped `<canvas>` share card
Subsetted Noto Sans JP, `document.fonts.ready` before draw, eager blob, `navigator.share({files})` + `<a download>` fallback (iOS gesture-safe). Folder-tab framing + toy diorama per the approved mockup (B).

### D1 — bottom tab bar `地図 · 統計 · 取込` + mark FAB.
### D2 — import review-and-resolve screen (renders `needsReview`, confirm/skip suggested matches → `ImportResolution`). The product's hero moment.
### D3 — folder-tab card + glowing-line treatment per `DESIGN.md` (owns `src/design/tokens.ts`).
### D4 — interaction states: loading / empty / error / success / offline overlay (the full matrix in `DESIGN.md`).
### D5 — "map floods green on import" signature animation + the % counter tick.
### D6 — desktop side-panel responsive layout (not stretched mobile).
### D7 — Noto Sans JP subset build step (single owner) + emerald-800 small-text contrast rule.
### T10 — CSV export + export-nag + `storage.persist()` + empty-state UX.
### T11 — optional "group legs into a trip" for manual rides.

## Boundary
You consume `RailGeoPackage` from the engine; you own `CoverageResult`, `ImportReport`, the store, and all UI. The engine's golden tests (T7) + E2E (T12) gate your output — treat them as the truth, not your own sense of "done."
