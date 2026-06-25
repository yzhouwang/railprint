# Plan — cross-line route-finding for ride marking

Branch: `codex/S2-line-rank` · Fixes the 津 → 大阪難波 (特急ひのとり) marking bug.

## Problem

Marking is line-first: `segmentsBetween(lineId, A, B)` (resolver.ts:31) requires both stations on
ONE line, and `inferLine` (search.ts:189) returns `status:'none'` when two stations share no single
line. So a through-service spanning multiple lines is a dead end. 津 → 大阪難波 on 特急ひのとり runs
名古屋線 (津→伊勢中川) → 大阪線 (伊勢中川→大阪上本町) → 難波線 (大阪上本町→大阪難波) — three lines.

**The data already supports it.** The per-segment `RideEvent` has no line constraint, and the junctions
connect via shared `stationGroupId` (the transfer relation `inferLine` already uses):

```
津[006905] --名古屋線--> 伊勢中川[007488] --大阪線--> 大阪上本町[007323] --難波線--> 大阪難波[007308]
                         ^ 名古屋線+大阪線 share          ^ 大阪線+難波線 share
```

Verified in `public/rail/jp-2025.json`. The route is a connected path through the segment graph. **No
data fix needed.**

## Locked decisions (plan-eng-review + Codex outside voice, 2026-06-25)

- **D2 → k-shortest, you pick.** Yen's k-shortest over Dijkstra (k≈3), ranked by `(line changes, then km)`.
  A route-picker lists candidates; you tap the one you rode. Disambiguates loop direction + parallels.
- **D3/D5 → unify SEARCH-mode only; defer map-tap.** Route-finding becomes the search-flow path (single
  line = degenerate 0-change route, replacing `inferLine`). **Map-tap stays line-first** (today's fast
  path). The bug is a search-mode flow (you can't tap two stations 300 km apart). The map-tap
  station-first rework is deferred (Codex flagged real transfer-dot/LOD disambiguation risk).
- **D6 → re-stamp overlapping legs into the new trip, SAFELY.** A marked route forms one `tripId`. Legs
  already in the log get their `tripId` **updated in place** (UPDATE, never a duplicate INSERT — the
  duplicate-insert is exactly the v0.2.0.0 bloat bug). One event per segment preserved. Semantic: the
  most-recent marking re-groups overlapping legs into the new trip.
- **D4 → Codex algorithm / Claude UI**, with **steering bumping the contract first** (`RouteCandidate`
  in `src/contract/types.ts` is steering-owned, not a Codex edit).

## Cost model (the load-bearing spec — get this exactly right)

Ranking by "line changes then km" MUST be encoded in the Dijkstra weight, not computed after the path is
found — otherwise the search optimizes km-first and can push the intended low-change route out of top-k.

```
NODE COST = a LEXICOGRAPHIC pair (lineChanges, km), compared (changes asc, then km asc).
EDGES
  segment edge   cost (0, km)   — staying on the same lineId
  line-change    cost (1, 0)    — the FIRST segment edge on a different lineId than the edge used to
                                  arrive counts the change. Attribute exactly ONE change per actual
                                  line switch (the hub double-edge below must not double- or zero-count).
GRAPH (avoid the zero-cycle trap Codex flagged)
  nodes = (line, station) instances, keyed by stationId.
  transfer: model the change at the SEGMENT level by line-id comparison, NOT as free hub edges that
            create zero cycles. Concretely: edges connect station instances that are (a) consecutive on
            a line [segment], or (b) the SAME physical stop on different lines via stationGroupId
            [boarding switch]. A switch edge carries (1,0); a same-line continue carries (0,km).
  This keeps every edge cost ≥ (0, >0) OR (1, 0): no zero-cost cycle, Dijkstra/Yen stay well-defined.
DETERMINISM  ties broken by (lineChanges, km, then a stable lexicographic key of the segmentId list) so
             runs are reproducible and Yen's loopless spurs don't oscillate.
"line changes" ≠ "transfers": a through-train (ひのとり) is one seat across 3 line IDs. The UI labels
  this "N路線" (lines used) / changes, NOT "N回乗り換え" — we cannot infer one-seat rides from N02.
```

## findRoutes contract

```
findRoutes(graph, groupKeyA, groupKeyB, pkg, k=3): RouteCandidate[]
  RouteCandidate = { segmentIds[] (in travel order), lines[] (distinct lineIds in order),
                     totalKm, lineChanges, railGeoVersion }
RULES
  - SINGLE PACKAGE only: route-find within ONE RailGeoPackage; stamp its railGeoVersion. (No cross-country
    trains exist; cross-package routing is out of scope — Codex finding.)
  - KEEP ALL single-line (0-change) routes: return every 0-change route (the old inferLine 'many'
    behavior at big stations), THEN up to a few lowest-cost multi-change routes, capped at the larger of
    k and the 0-change count. Never drop a shared-line option.
  - dedupe by segment-set; rank (lineChanges asc, km asc).
  - CAPS (Codex perf finding): bail to "single shortest + mark leg-by-leg" if a route exceeds
    MAX_ROUTE_STATIONS (~80) or Yen exceeds MAX_SPURS (~50). Bounds national-scale pathological inputs.
  - A==B → []. disconnected → [].
```

## Data flow (search-mode)

```
search 津 (type) ─→ resolveQuery ─→ pick a hit ─→ groupKeyOf(A) ┐
search 大阪難波 ──→ resolveQuery ─→ pick a hit ─→ groupKeyOf(B) ┘
                                          ▼
                       findRoutes(graph, grpA, grpB, pkg, 3)     ← graph memoized by package identity
                                          │
              ┌───────────────────────────┼───────────────────────┐
          0 routes                 1 route                    ≥2 routes
       "経路が見つかりません"     confirm & mark             ROUTE-PICKER (.line-chip rows:
                                          │                 "名古屋線 › 大阪線 › 難波線 · N区間 · XX km")
                                          └──────────┬──────────────┘ user taps one
                                                     ▼
                       store.markRoute(route, pkg, {date, trainModel})
                         → db.markRouteSegments: UPDATE existing legs' tripId in place +
                           INSERT new legs, all one tripId, atomic  → litSegmentIds → all legs light
```

## What already exists (reuse, don't rebuild)
- `stationGroupById` (store.ts:76) — transfer adjacency primitive → the graph's switch edges.
- `segmentsBetween` (resolver.ts) — **kept** (loop-arc logic + tests); the route graph handles loops
  natively, so the search UI stops calling it (tap-mode still uses it via markRide).
- `addRideSegments` (db.ts:59) — atomic insert-if-absent. `markRouteSegments` is its sibling that ALSO
  re-stamps existing legs' tripId (D6-B); shares the rw-transaction idiom.
- `lineChoices` → `.line-chip`/`.line-list` picker (MapView.svelte:807) — the route-picker reuses it.
- Set-based `litSegmentIds` — a multi-line route lights up with zero map changes.

## Module / file plan + lane split
**Steering (me) FIRST:** add `RouteCandidate` to `src/contract/types.ts` (steering-owned bump), then:

### Codex (engine/logic · `src/lib/route.ts` + `src/lib/route.test.ts`, offline-verifiable)
- `buildRouteGraph(pkg): RouteGraph` — instances + segment edges + stationGroupId switch edges;
  memoized by package identity (WeakMap, like `segmentIndex`).
- `findRoutes(graph, grpA, grpB, pkg, k)` — lexicographic Dijkstra + Yen, the cost model + caps above.

### Claude (experience · `src/lib/db.ts`, `src/lib/store.ts`, `src/lib/search.ts`, `src/screens/MapView.svelte`)
- `db.markRouteSegments(routeSegmentIds, template, pkg)` — atomic: read existing events for these
  segmentIds, UPDATE their tripId (+date/trainModel) in place, INSERT missing; one event per segment.
- `store.markRoute(route, pkg, opts)` — wraps it, returns MarkResult-like (added + km + tripId).
- search.ts: replace `inferLine` with a `findRoutes` adapter for the search flow.
- MapView: search-mode route-picker + `routeChoices` state. **Tap-mode untouched.**

Commits sequenced: steering contract bump → Codex route.ts → Claude UI. Lanes A/B parallel against the
frozen `RouteCandidate` + `findRoutes` signature.

## Test coverage plan (100% of new paths)

```
route.ts (Codex)                                                     TEST
buildRouteGraph — segment edges / switch edges via stationGroupId    route.test ★★★
  solo station (no group) — no switch edge                           route.test ★★
  memoized by package identity                                       route.test ★★
findRoutes
  single-line 0-change == segmentsBetween (PARITY regression guard)  route.test ★★★
  3-line 津→大阪難波 (real package fixture) — THE BUG                  route.test ★★★
  keep ALL single-line routes at a many-shared-line station          route.test ★★★  (inferLine parity)
  loop line: two arcs surfaced, shorter first                        route.test ★★★
  ranking: fewer line-changes beats shorter km (cost-model proof)    route.test ★★★
  deterministic tie-break (stable output)                            route.test ★★
  A==B → [] ; disconnected → [] ; caps → leg-by-leg fallback         route.test ★★★
db.markRouteSegments / store.markRoute (Claude)
  new route: all legs one tripId                                     store.test ★★★
  OVERLAP re-mark: existing legs RE-STAMPED to new tripId, NO dup    store.test ★★★  (D6-B + no-bloat)
  event count stable after re-mark (one per segment)                 store.test ★★★  (v0.2.0.0 guard)
  concurrent double-mark                                             store.test ★★
USER FLOW
  search 津 + 大阪難波 → picker → pick 3-line route → legs light      [→E2E] reuse SwiftShader harness
  no-route pair → visible "経路が見つかりません" (not silent)          [→E2E] / UI unit
```

## Failure modes
| Path | Failure | Test | Handling | User sees |
|------|---------|------|----------|-----------|
| findRoutes | disconnected pair | yes | `[]` | "経路が見つかりません" |
| findRoutes | national-scale blowup (津→博多) | cap test | MAX_ROUTE_STATIONS / MAX_SPURS → leg-by-leg | bounded list + hint |
| findRoutes | huge transfer complex floods candidates | yes | keep-all-single-line + k cap + dedupe | sane list |
| markRouteSegments | overlap re-mark | yes | UPDATE in place (no dup) | trip completes, log clean |
| markRouteSegments | concurrent | yes | atomic rw-txn | "記録済み" no-op |

No silent-failure critical gaps: every failure returns `[]` or surfaces a toast.

## NOT in scope
- **Map-tap station-first rework** (D5) — deferred; tap-mode stays line-first. Re-homing the
  tap-disambiguation + LOD-visibility is a separate task.
- Cross-package (cross-country) routing — single-package only; no such trains exist.
- One-seat-ride / train-service modeling — N02 has no service data; we surface "lines used," not
  "transfers." Filtering by train type is out.
- Journey-planner features (times, fares) — this logs what you rode.
- Route-picker visual design (row layout, multi-line rendering) — defer to /plan-design-review.

## Parallelization
| Lane | Modules | Depends on |
|------|---------|-----------|
| S (steering) | `src/contract/types.ts` (RouteCandidate) | — (lands first) |
| A (Codex) | `src/lib/route.ts` (+test) | S |
| B (Claude) | `src/lib/db.ts`, `src/lib/store.ts`, `src/lib/search.ts`, `src/screens/MapView.svelte` | S; A's findRoutes signature (stub until it lands) |

Launch A + B in parallel after S; sequence commits S → A → B.

## Implementation Tasks
- [ ] **T0 (P1, CC: ~5min)** — steering — add `RouteCandidate` to `src/contract/types.ts`
- [ ] **T1 (P1, CC: ~30min)** — route.ts — graph + lexicographic Dijkstra/Yen `findRoutes` + caps + full vitest (Codex)
  - Verify: `vitest run src/lib/route.test.ts` incl. 津→大阪難波 fixture, segmentsBetween parity, cost-model ranking proof
- [ ] **T2 (P1, CC: ~20min)** — db.markRouteSegments (re-stamp upsert) + store.markRoute + tests (Claude)
  - Verify: overlap re-mark re-stamps tripId with NO event-count growth
- [ ] **T3 (P1, CC: ~25min)** — search-mode route-picker; replace inferLine with findRoutes; tap-mode untouched (Claude)
- [ ] **T4 (P2, CC: ~10min)** — e2e: search 津 + 大阪難波 → pick 3-line route → legs light (reuse SwiftShader harness)

## Route-picker design (plan-design-review, 2026-06-25)

Initial 5/10 → 9/10. Reuses `.line-chip`/`.line-list` (MapView.svelte:907) + the emerald tokens; only
the chip composition + states are new. (Component-in-system, so spec'd against `docs/DESIGN.md` tokens,
not greenfield mockups.)

```
ROUTE CHIP (≥2 lines) — two-line, reuses .line-chip (min-height ~60px; sequence may wrap):
  line 1: 16px line LOGOS (D2-B), swatch fallback where a line has no logo, joined by muted › separators
  line 2: "142.0 km · 28区間 · 3路線" — ink-muted #6B756F, ~0.85em.
          "N路線" (lines used), NOT "乗換N回": a through-train (ひのとり) is one seat across N line IDs,
          so "transfer" would be a lie (the eng-review line-changes≠transfers decision).
  rank-1: subtle muted "おすすめ" pill (D3-A — ink-muted text/light fill, NOT the emerald .hsr pill);
          remaining routes ordered best-first, no badge.
SINGLE-LINE route (0 line changes): render as today's normal 1-line chip (company + logo + name), no
  metadata clutter — the degenerate case must look unchanged.
NO ROUTE (D4-A): warm 2-line message "経路が見つかりませんでした / この2駅をつなぐ線路がありません" + an
  emerald "各区間を分けて記録" button that drops back to single-line marking. Never a bare dead-end.
LOADING: route-finding is sub-ms — show the picker directly; only the cap/slow fallback shows a brief
  "経路を探索中…".
CONFIRM toast (reuse): "経路を記録しました（+N区間 / +XX.X km）".
A11y: each route chip is a ≥44px tap target (taller when two-line), keyboard-focusable <button> (already
  is); logos + › get aria-hidden, the chip's aria-label reads the line names + km so a screen reader
  gets the route, not "image image image".
```

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 13 gaps — folded or decided |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 6 decisions locked, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | 5/10 → 9/10, 3 decisions (chip, rank cue, no-route) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**CODEX:** outside voice found 13 gaps. Folded into the plan: lexicographic `(lineChanges, km)` cost
(no zero-cycle hubs), keep-all-single-line routes, single-package + per-segment version, Yen caps,
terminology ("line changes" not "transfers"), and steering bumps `RouteCandidate` first. Two surfaced as
user decisions below.
**CROSS-MODEL:** Review said "unify station-first"; Codex flagged the map-tap rework as risky → resolved
**D5-A** (search-mode now, defer map-tap). Trip completeness on overlap → **D6-B** (safe in-place
`tripId` re-stamp, never a duplicate insert).
**DESIGN:** route-picker spec'd 5→9/10 — two-line logo chip + metadata ("N路線"), muted "おすすめ" on
rank-1, warm no-route state with a leg-by-leg fallback, a11y aria-labels.
**VERDICT:** ENG + DESIGN CLEARED — ready to implement.

NO UNRESOLVED DECISIONS
