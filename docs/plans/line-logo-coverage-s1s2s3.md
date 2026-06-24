# Plan: Line-logo coverage (38% → ~55%+), outside-voice-revised

**Branch:** feat/record-highlight-bilingual · **Lanes:** Codex (engine, offline) + Claude (data fetch + audit + QA)
**Contract:** `src/contract/types.ts` UNTOUCHED — `RailLine.logo` already exists. No steering bump.
**Revision:** Codex outside voice (2026-06-25) showed the QID crosswalk was premature — the 93 unused PNGs are a
name-vs-`src` indexing bug, not a missing-entity-ID problem. QID work **deferred** pending the measured audit.

## Problem (verified)

227/594 (38.2%) ship a logo. Audit proved it's an ingestion gap, not a content ceiling. Numbers
(measure-logos.mjs + reading pipeline/line-style.ts):
- Cache has **342 (op,name) keys with a logo**; we ship **227**. → 115 matchable-but-unshipped.
- **320 PNGs already on disk** (`data/readings/logos-raw/`); **343 of the cache's logo URLs already exist in
  logo-index by `src`** (Codex-verified) → the gap is an **index-by-name-vs-`src`** bug.
- **22 keys dropped by the multi-value rule** — all 22 have their PNG on disk.

## Bugs (verified in pipeline/line-style.ts)
```
BUG 1 — multi-value drop (line 221): firstUniqueSourceStyle keeps logoSrc only if all matched
        rows agree → through-running lines (総武 JO+JB, 常磐 JJ+JL, 中央本線) → undefined → no logo.
BUG 2 — index-by-name + exact-src gate (256-261): logoIndex is keyed by Japanese NAME and also
        requires logo.src === match.logoSrc. The cache references logos by src URL, and the
        downloaded PNGs are addressable by src — so name-keying strands ~93 on-disk PNGs.
```

## Correctness traps the gate MUST catch (Codex)
- **Wrong-operator badge:** `北陸新幹線` cache has BOTH `Shinkansen jrw.svg` and `Shinkansen jre.svg`; a naive
  primary-pick can attach JRW to the JR-East line and still pass "has a logo."
- **Shared/region-swapped symbol:** cache maps `九州旅客鉄道 / 山陽本線` to a JR-West Kinki symbol — wrong region.
- Presence-only no-regression gate is **too weak** — it cannot see a right→wrong logo swap.

## S1 — index repair + operator-aware pick (Codex, offline, NO new data)

**File:** `pipeline/line-style.ts`. **Goal:** rescue the on-disk PNGs *correctly* — coverage is a side effect of a
correct join, never the target.

1. **Index logo-index by `src`** (the Commons URL), not only by name. Build a `Map<srcUrl, LogoIndexEntry>` so a
   matched row's `logoSrc` resolves to its downloaded PNG regardless of name variant.
2. **Operator-aware primary pick** in `firstUniqueSourceStyle`: when a line matches ≥2 candidate `logoSrc`,
   pick the one whose symbol belongs to the **line's own operator family** (e.g. JR-East line → `...jre...` /
   `JR J* line symbol`; JR-West → `JRW ...`). Tiebreak deterministically (lexicographic). If NO candidate matches
   the operator family, attach **nothing** (fail-closed — a wrong badge is worse than none). No `Date`/random.
3. **Loosen only the fragile half** of the gate: resolve the PNG by `src` (step 1); keep the on-disk existence
   check. Never attach a PNG whose src didn't come from this line's matched rows.

## Measured audit — the keystone, replaces the QID guess (Claude; = the user's "remaining lines" pass)

After S1 builds, produce `data/readings/logo-coverage-report.json` partitioning all 594 lines:
- **(a) recovered** — now has a correct on-disk logo.
- **(b) cache-has-src-not-downloaded** — a `logoSrc` exists in the cache but no PNG → S2 fetch target.
- **(c) no-src-in-cache** — needs net-new discovery (Wikidata entity P154 by QID, or genuinely none).
- **(d) genuinely unbadged** — verified no official symbol exists (rural/3rd-sector/tram/Sendai/Fukuoka subway).
Each (c)/(d) line gets a verified yes/no "does a symbol exist on Commons" via a research workflow. This report
right-sizes S2 and tells us the TRUE ceiling — no vanity %.

## S2 — targeted backfill (Claude fetch + Codex consume), scoped BY the audit
Only buckets (b) and (c)-with-a-real-symbol. `wbgetentities`/`Special:FilePath` → SVG→PNG 64px → `logos-raw/` +
`logo-index.json`. **Percent-encode macron filenames** (`Keikyū`, `Kōbe`, `Kyōto`). Net depends on the audit;
expected mid-50s%. Build stays offline; Claude commits PNGs + index, Codex rebuilds.

## S3 (QID crosswalk) — DEFERRED
Premature per cross-model consensus. Its correctness aim (kill 山手線/Yamanote + wrong-operator collisions) is met
more cheaply by S1's operator-aware pick + the exact-logo gate. Revisit only if the audit shows a residue of
collisions that operator-family matching can't resolve. Captured as a TODO, not built here.

## Tests / gate (pipeline/verify-jp.ts — in `npm test`)
- **EXACT-logo goldens (derived from real cache data, not guessed):** assert specific lines map to a specific
  expected logo filename — at minimum one JR-East J-code line, one JR-West Kinki line, and the `北陸新幹線`
  operator-disambiguation case (JR-East line must NOT get the JRW symbol).
- **No-regression (IRON RULE, CRITICAL):** every line with a logo before still has one AND it's the same file
  (catches right→wrong swaps, not just presence).
- **Operator-family invariant:** every attached logo's filename is consistent with the line's operator family
  (no JRW symbol on a JR-East line).
- **Determinism:** two builds → byte-identical `logo-credits.json`.

## NOT in scope
- QID crosswalk / S3 re-architecture — deferred (above).
- Per-file license tags (PD-textlogo vs CC-BY) — keep generic "Wikimedia Commons"; changing manifest semantics +
  UI is its own task. TODO.
- ja-Wikipedia infobox `|ロゴ=` / `|路線色=` harvest (S4) — overlaps S2; defer.
- Contract change — none.

## What already exists (reuse)
- `RailLine.logo` + map rendering (popup/picker/search) — consumes whatever ships.
- Commons SVG→PNG path (`logo-index.json`, `logos-raw/`, `Special:FilePath?width=64`) — reuse for S2.
- `OPERATOR_ALIASES` / `lineNameAliases` — extend for operator-family detection.
- `logo-credits.json` + C7 attribution — reuse as-is (generic credit).

## Failure modes
| Codepath | Failure | Test? | Handling | Visible? |
|---|---|---|---|---|
| S1 src-index | name/src drift strands a PNG | recovered-count + golden | resolve by src | missing logo |
| S1 operator pick | wrong-operator badge attached | operator-family invariant + 北陸 golden | fail-closed if no family match | wrong badge |
| S1 gate | right→wrong swap passes | no-regression = same-file | exact-file compare | wrong badge |
| S2 fetch | macron 404 / WDQS 503 | (offline build unaffected) | percent-encode + entity API | missing logo |

## Lanes (SEQUENTIAL — Codex sandbox can't fetch; no parallel alias-drift)
| Step | Owner | Modules | Depends on |
|---|---|---|---|
| L1: S1 index repair + operator pick + gate | Codex | pipeline/line-style.ts, verify-jp.ts | — |
| L2: measured audit + remaining-lines research | Claude | data/readings/ (report) + workflow | L1 |
| L3: S2 targeted fetch | Claude | data/readings/ (PNGs, index) | L2 |
| L4: rebuild + gate + browser QA | Codex build, Claude QA | pipeline/ build | L3 |

Order: **L1 → L2 → L3 → L4.** No parallelism (each needs the prior; Codex offline, Claude network).

## Implementation Tasks
- [ ] **T1 (P1, CC ~20min)** — line-style.ts — src-keyed logo index + operator-aware primary pick + fail-closed. Verify: build logo count rises, NO wrong-operator attach.
- [ ] **T2 (P1, CC ~15min)** — verify-jp.ts — exact-logo goldens + same-file no-regression + operator-family invariant + determinism. Verify: `npm test` green.
- [ ] **T3 (P1, CC ~25min)** — measured audit report + remaining-lines research workflow (Claude). Output: logo-coverage-report.json with (a)/(b)/(c)/(d) partition + per-line symbol-exists verdict.
- [ ] **T4 (P1, CC ~20min)** — S2 targeted fetch (Claude) for buckets (b)/(c)-with-symbol, macron-safe. Verify: index grows, rebuild, gate green.
- [ ] **T5 (P3 TODO)** — per-file license tags; QID crosswalk if audit shows unresolved collisions.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 5 issues, 0 critical gaps |
| Outside Voice | `codex exec` | Independent 2nd opinion | 1 | issues_found | 12 points; 5 absorbed |

- **CODEX:** flagged the QID crosswalk as premature (343 cache logo URLs already on disk by `src`), the wrong-operator badge trap (北陸新幹線 JRW vs JRE), and presence-only gate weakness. Absorbed into the revision.
- **CROSS-MODEL:** Review proposed a QID crosswalk keystone; outside voice showed it was a name-vs-`src` indexing bug. Resolved toward the outside voice — deferred QID, switched to src-index + operator-aware pick + exact-logo gate.
- **VERDICT:** ENG CLEARED — ready to implement (S1 → audit → S2; S3/QID deferred).

NO UNRESOLVED DECISIONS
