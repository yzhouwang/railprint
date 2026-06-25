# Plan: zoom-tiered map (level-of-detail) + P1 render-perf fix

**Branch:** codex/S1-line-logo (next milestone) · **Lanes:** steering (contract) + Codex (engine rank) + Claude (experience render)
**Scope:** render-LOD (show fewer lines zoomed out, more zoomed in) + fold the deferred P1 `litStationIds` repaint fix. NOT data lazy-load.
**Revision:** Codex outside voice (read the installed maplibre-gl 5.24) corrected the mechanism — filters DO support `['zoom']`+feature, so this is ONE layer + a filter, not 5 layers.

## Problem
All 594 lines + ~10k station dots render at every zoom (no `minzoom` on the line layers — only zoom-interpolated width). National view is a hairball; we draw 9,442 segments when looking at all of Japan. Separately `style.ts:206 litStationIds()` rebuilds a 9,442-entry `byId` Map **every repaint** — the P1 landmine.

## Confirmed decisions (plan-eng-review, user)
1. **Low-zoom view = trunk tiers + your ridden lines** (national view shows the spine + any line you've ridden, any tier).
2. **Ranking = heuristic + curated overrides.**
3. **Storage = `RailLine.rank` contract field** (build-time, steering bump).
4. **5 visible tiers** (5 zoom reveal-steps), not 3 buckets.
5. **Perf fix = memoize adjacency + lean on LOD** (measure first; defer the feature-state rewrite).

## Tier scheme (rank 0-4 → per-segment `minz` zoom threshold)
| rank | tier | `minz` | what | heuristic |
|---|---|---|---|---|
| 0 | Shinkansen | 4 | bullet-train spine | `isHSR` |
| 1 | Trunk | 7 | 東海道/山陽/東北/中央本線, **major private intercity** (近鉄大阪/名古屋, 名鉄名古屋本, 小田急小田原, 京急本, 南海本/高野, 東武伊勢崎/日光, 西鉄天神大牟田) | **curated trunk set** (NOT km>80 — that wrongly promotes 只見/五能/釧網) |
| 2 | Urban | 9 | **山手線, 大阪環状線**, subways, metro-area private | subway/private + dense short JR (stations/km high) |
| 3 | Local | 11 | rural JR + regional private | default for JR-rural and mid private |
| 4 | Minor | 12 | trams, cable cars, 3rd-sector | tram/鋼索/short 3rd-sector |

Curated overrides win over the heuristic for the marquee set. **Caveat (Codex):** service names like 京浜東北線/埼京線/上野東京ライン are NOT separate line records in the package — overrides can't summon them; they ride their physical parent line's tier.

## Architecture — render-LOD: ONE layer + a combined filter (Codex-corrected, [Layer 1])
maplibre-gl 5.24 filters accept `['zoom']` mixed with feature data (verified in the installed
`feature_filter` source). So the base `rp-line` layer stays ONE layer; we add a filter:

```
rp-line.filter = ['any',
   ['>=', ['zoom'], ['get','minz']],          // visible once zoom reaches its tier
   inFilter('segmentId', litSegmentIds)]      // OR it's ridden → visible at ALL zooms (decision #1)

  - paint (color/opacity/width) unchanged: still ['case', isLit, ridden, unridden].
  - repaint() now updates this ONE layer's FILTER (lit clause) + the 2 lit paint props. Still one layer
    (NOT 5, NOT an overlay) → no double-draw, no z-order glitch, station hover/tap untouched.
  - buildSegmentCollection() stamps a per-segment `minz` (from the line's rank). One new prop.
STATION DOTS: ONE layer (keep — MapView wires click/mouse to the single STATIONS_LAYER) + the same
  ['any', zoom>=minz, ridden] filter. Station `minz` = min(minz of its lines).
GLOW / CASING: unchanged. Glow self-limits to ridden (width 0 when unlit), so a ridden minor line
  glows at all zooms (consistent with #1); unridden minor lines add no glow clutter.
```

**Coverage % unaffected** — LOD is purely visual; the resolver reads the full `packages`, never the layers. Test asserts `resolveCoverage` still receives all segments (NOT through rendered source).

## Architecture — P1 perf fix (partial, measure-first)
1. **Memoize the segment→station adjacency** once, keyed by **package object identity** (NOT `version` — stub JP + CN both `2025.1.0`), so `litStationIds()` stops rebuilding 9,442 entries per repaint. Handle `packages` swapping after the fallback-retry self-heal (re-memoize on new identity).
2. **Lean on LOD:** fewer rendered features at low zoom directly shrinks the `['in', id, ['literal', lit]]` indexOf cost (O(rendered × lit)). Codex confirmed memoize alone doesn't remove that indexOf — it's why we measure on a real device and only escalate to feature-state (O(1)/feature) if jank persists. Feature-state rewrite = **out of scope** (touches the lit channel; the deferred "measure first" item).

## Code quality
- Build the per-tier reveal from a `TIERS` config (zoom thresholds in one place), not magic numbers scattered.
- Extract `inLiteral(prop, arr)` (TODO: repeated 4× in style.ts) while here.
- Rank heuristic + curated trunk/override tables live in the **engine** (`pipeline/`), pure + unit-tested — not the UI.

## Tests
- **Engine units:** rank goldens — 東海道新幹線→0, 東海道本線→1, 近鉄大阪線→1 (major-private trunk), 山手線→2 (override), 大阪環状線→2, 只見線→3 (NOT 1 — the km-trap), 広島電鉄 tram→4. Override-beats-heuristic. `verify-jp` hard gate: every line rank 0-4; tier-0 count == HSR count; no tier empty.
- **Perf unit:** adjacency memoized — second `litStationIds` on the same package identity reuses the cache; a new package identity rebuilds.
- **Render-LOD = visual:** real-GPU spot-check at z5 (Shinkansen+trunk + any ridden) and z11 (all). MapLibre zoom-culling isn't unit-testable — mark [→E2E]/manual.
- **Regression (IRON RULE):** coverage % byte-identical before/after; assert resolver receives all segments.

## NOT in scope
- Data lazy-load (needs a coverage-totals manifest so % stays correct) — render-LOD is its prerequisite.
- Feature-state lit rewrite (deferred "measure first"). Line-romaji/logo P3s.

## Failure modes
| Codepath | Failure | Test? | Handling | Visible? |
|---|---|---|---|---|
| rank heuristic | trunk/major-private mis-tiered (km-trap) | rank goldens + curated sets | curated trunk + major-private tables, NOT km | line absent at expected zoom |
| combined filter | lit clause not re-applied on ride → ridden line hidden at low zoom | manual z5 after marking | repaint setFilter includes lit clause | ridden line vanishes zoomed out |
| station `minz`=min(lines) | minor station on trunk shows early | histogram sanity | intentional (trunk station IS major) | extra dots |
| memoize | stale cache after fallback-retry swaps packages | identity-key test | key on package identity; re-memoize on swap | wrong dots |

## Lanes (split)
| Lane | Owner | Files | Depends on |
|---|---|---|---|
| L0: contract bump | steering | src/contract/types.ts (`rank?: 0\|1\|2\|3\|4`) | — |
| L1: rank heuristic + curated trunk/override tables + gate | Codex (engine) | pipeline/ (rank module), verify-jp.ts, rebuild package | L0 |
| L2: combined zoom+ridden filter on line + station layers, per-segment `minz`, byId memoize, inLiteral DRY | Claude (experience) | src/lib/map/style.ts, src/screens/MapView.svelte | L0; L1 to QA |

L1 (pipeline/) ∥ L2 (src/) after L0. Merge, rebuild, real-GPU QA at z5/z11, coverage regression.

## Implementation Tasks
- [ ] **T1 (P1)** — contract: `RailLine.rank?: 0|1|2|3|4`. (steering)
- [ ] **T2 (P1)** — engine: rank heuristic + curated trunk/major-private/override tables + `verify-jp` gate + goldens; rebuild package with per-line rank. (Codex)
- [ ] **T3 (P1)** — style.ts: per-segment `minz` from rank; `['any', zoom>=minz, ridden]` filter on the line layer + station layer; TIERS config; extract `inLiteral`. (Claude)
- [ ] **T4 (P1)** — adjacency memoize keyed by package identity + perf unit test; wire repaint to update the line filter's lit clause. (Claude)
- [ ] **T5 (P1)** — real-GPU QA at z5/z11 + coverage-% regression test. (Claude)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 3 user decisions + 5 tiers + perf-depth resolved |
| Outside Voice | `codex exec` | Independent 2nd opinion | 1 | issues_found | 14 points; ~11 absorbed, 2 → user |

- **CODEX:** read the installed maplibre-gl 5.24 and corrected the core mechanism (filters DO support `['zoom']`+feature → ONE layer, not 5 + overlay; fixes repaint-multi-layer, double-draw, station-hover breakage). Also: km>80 heuristic mis-tiers rural JR + demotes major-private trunks (fixed → curated sets); service-name lines aren't records; memoize by identity not version; the indexOf cost remains (→ measure-first perf depth).
- **CROSS-MODEL:** Review proposed 5 tier layers + a ridden overlay; outside voice proved a single zoom+ridden filter is supported and simpler. Resolved toward the outside voice (absorbed). User decided the two genuine forks: 5 visible tiers; memoize+LOD (not the feature-state rewrite).
- **VERDICT:** ENG CLEARED — ready to implement (steering bump → Codex rank ∥ Claude render → GPU QA).

NO UNRESOLVED DECISIONS
