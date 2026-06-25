# TODOS — RailPrint

## Deferred (captured by /plan-eng-review 2026-06-23)

### rail-geo version migrations
- **What:** A migration path for when the rail-geo dataset is re-versioned (re-stitched N02): map old→new station/segment IDs and quarantine coverage references that can't be resolved.
- **Why:** Stored coverage is a set of references to rail-geo IDs. When IDs split/merge/shift on a data-quality release, "warn on mismatch" silently changes the meaning of a user's saved rides — risking corruption of lifetime logs.
- **Pros:** Protects every user's history across data updates; makes geometry improvements safe to ship.
- **Cons:** Real work (ID-diff + quarantine UX); premature for v0 (only one rail-geo version exists at launch).
- **Context:** v0 already pins the rail-geo version in each ridelog and warns on mismatch — that buys runway. This TODO comes due **before the second rail-geo release**, not before launch. Both outside voices (Codex + Claude subagent) flagged "warn isn't enough."
- **Depends on:** rail-geo being versioned (v0), at least two published vintages.

---

## Deferred (captured by /ship 2026-06-24 — N02 integration review + adversarial)

### Map render perf at scale
- **Priority:** P1
- **What:** `litStationIds` (map/style.ts) rebuilds a ~9,442-entry segment→station Map from scratch on every repaint; `MapView.repaint()` is the per-frame flood callback (up to 48×) → ~453k Map inserts per import flood on the main thread. Memoize the static adjacency once on package load; when measured, precompute a `lit` boolean into feature props (or feature-state) so paint is O(1) per feature instead of O(features × ridden-set).
- **Why:** Flagged CRITICAL by the adversarial pass; matches the eng-review's deferred "ship-as-is + measure" render-perf decision. Bites flood animations and completionist users (thousands of ridden segments).
- **Depends on:** real-device /qa showing the jank before optimizing (boring-by-default).

### markRide concurrent-mark race
- **Priority:** P2
- **What:** `markRide` reads `get(events)` synchronously, then `await db.putEvents`. Two back-to-back marks (fast double-tap, importer/corridor paths) read the same pre-write snapshot and both persist events for the same segments with different ids — `bulkPut` doesn't dedup, so the durable log + CSV export bloat (coverage % is unaffected, it's set-based). Same class as the fixed partial-overlap re-stamp. Add an in-flight guard in `markRide` (the UI guards via `busy`, but the function doesn't).

### Offline / PWA tier + first-paint perf
- **Priority:** P2
- **What:** The ~1.6 MB gzip package fetch + OSM raster basemap need an offline story (the eng-review flagged the raster basemap as an online-only dependency). Consider region-tiling / lazy-load and worker-parsing the package so first paint never blocks on the full national network.

### Adapter robustness
- **Priority:** P3
- Synthetic bridge km (~5 km / 0.02% network-wide) is baked into segment `km` and thus `totalKm`; enforce a network-wide synthetic-km bound in `verify-jp`, or subtract it, if bridging ever grows.
- Loop classifier: `LOOP_ISO_RATIO=0.04` is blunt for high-aspect-ratio rectangular loops, and single-section closed loops are discarded at the `a===b` graph guard. Harden if a real loop is mis-classified.
- Add a synthetic branch/lollipop unit test that directly triggers the under-length chord repair (currently only gated on real data via `verify-jp`).
- DRY in `map/style.ts`: extract an `inLiteral(prop, arr)` membership helper (repeated 4×) and a `boundsOf(points)` reducer shared by `networkBounds`/`riddenBounds`.

---

## Deferred (captured by /plan-eng-review 2026-06-24 — record-highlight + bilingual feature)

### Line-name romaji: operator-aware join — DONE (v0.5.0.0)
- **Completed:** v0.5.0.0 (2026-06-25). The colors/logos engine lane made the line join operator-aware (operator+name, fail-closed on ambiguous), which fixed the collisions: 中央線 (JR East) → "Chuo Line" not "Osaka Metro Chuo Line"; 山手線 Tokyo ≠ Kobe. Coverage is now 256/594 (43%) — slightly down from the 287 exact-name matches, but correct-only (no wrong operator-prefixed labels). Further coverage gains (75-85%) would need fuzzy 本線↔線 matching — a P3 follow-up if desired.

### Station romaji residual review
- **Priority:** P3
- **What:** Engine flagged 629 low-confidence rows in `data/readings/station-readings-review.json` (90 coordinate-only Tier-2, 321 Wikidata, 218 unmatched). Eyeball + add `overrides/jp-n02-overrides.json` entries for wrong/blank ones; verify large/multi-node station joins.
- **Why:** 97.65% + golden-pass shipped; the half-day manual pass lifts coverage + catches the coordinate-only mis-joins.

### wanakana chunk-split (minor)
- **Priority:** P3
- Rollup inlined `wanakana` into the main entry (small, single-consumer). True lazy-chunk-split is a minor build optimization if bundle size matters; runtime laziness already holds (only runs on a search cache-miss).

---

---

## Deferred (captured by /plan-eng-review 2026-06-25 — line-logo coverage S1+S2+S3)

Coverage went 227→287 (S1, operator-aware src-index) →349 (S2, ja-infobox audit backfill) = **58.8%**.
A 307-line audit verified the remainder: ~93 had a findable symbol, **214 genuinely have none**
(trams, cable cars, most rural 3rd-sector + rural JR — no official line symbol exists anywhere).

### Logo follow-ups (P3)
- **QID crosswalk / S3** — deferred (Codex outside voice: premature; the src-index + operator-family pick met the correctness aim). Revisit only if a residue of cross-operator collisions appears that operator-family matching can't resolve. See `docs/plans/line-logo-coverage-s1s2s3.md`.
- **Per-file license tags** — `logo-credits.json` still uses a generic "Wikimedia Commons" credit. ~40 CC-BY files (Kintetsu/Meitetsu/Kobe/Sapporo + new 3rd-sector logomarks) want accurate per-file license + author. Changing it touches the C7 attribution UI, so it's its own task.
- **Deferred audit candidates (28 lines)** — 11 giant numbering-chart PNGs (伊予鉄/西鉄 — 2200px, render poorly at 16px; need cropping/SVG substitutes), 13 low-confidence, 3 contested JR line-codes (筑豊 JE, 山陰 san-A, 総武 JO — agents disagreed). See `scratchpad/s2-dropped.json`.
- **Within-company JR line-code accuracy** — the operator-family gate catches cross-company JR errors but NOT wrong-code-within-a-company (e.g. JO vs JM on a JR-East line). The high-agreement picks are trusted; a future pass could add exact-code golden assertions per JR line.

_Promoted to v0 (not deferred): one China corridor (京沪高铁) through the pipeline to validate the country-agnostic schema — see docs/DESIGN.md → Implementation Tasks T9._
