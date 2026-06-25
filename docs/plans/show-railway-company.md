# Plan: show the railway company on the left of line name + logo

**Branch:** codex/S1-line-logo · **Lanes:** steering (contract) + Codex (engine build) + Claude (experience UI)
**Goal:** wherever a line is named, show its operator (e.g. `JR東日本`) as a muted label to the LEFT of the logo + bilingual name. Keeps the emerald brand; company is a secondary channel.
**Revision:** Codex outside voice (2026-06-25) — don't mutate the badge snippet (wrap risk), suppress redundant brand, JP-consistent labels, escape in popup HTML, hard-fail the verifier, truncate compact rows.

## What the user sees
Before: `[JY] 山手線 (Yamanote Line)`
After:  `JR東日本 [JY] 山手線 (Yamanote Line)`   (company = small, muted gray; logo + name unchanged)

## Architecture (auto-decided = recommended, Codex-absorbed)
1. **Data: `RailLine.operator` field.** Steering bump on `src/contract/types.ts`; populated from `raw.operator` at `n02-ingest.ts:533`. (Honest scope: this future-proofs JP; CN gets it only when the CN builder sets it too.) `verify-jp` **hard-fails** if any line is missing `operator` (not informational).
2. **Display: `companyLabel(operator)` helper** (`src/lib/company.ts`, pure) — short, **all-Japanese** labels:
   - JR: `〇〇旅客鉄道`→`JR東日本/西日本/東海/九州/北海道/四国`
   - Metro/municipal: `東京地下鉄`→`東京メトロ`, `大阪市高速電気軌道`→`大阪メトロ`, `東京都`→`都営`, `〇〇市`→`〇〇市営`, the long `一般社団法人札幌市交通事業振興公社`→`札幌市電` and similar known-ugly ones mapped explicitly.
   - Fallback: operator as-is after stripping `株式会社` / `一般社団法人` / `一般財団法人`. CSS ellipsis catches any still-long fallback.
3. **Render: a new `lineLabel` snippet** (NOT a mutation of the `lineMark` badge — Codex). `lineLabel(line)` renders `[company][logo|swatch][bilingual name]` as ONE flex row with `min-width:0` so the name ellipsis-truncates as a unit. Replaces the `lineMark + name` pairs at the full-label call-sites (picker, selection panel, shared-line picker). `lineMark` (badge only) stays for the compact inline spots, which get the company via a small inline `<span class="line-co">` + truncation CSS.
4. **De-dup:** suppress the company when the line name already leads with its brand (`line.name.startsWith(label)` or shared brand token), so we never show `東急 東急東横線`.
5. **Bilingual company?** Japanese-only v1 (follow-up for romaji — ~150 operators is its own data task).

```
data:   N02 raw.operator ──(n02-ingest:533)──> RailLine.operator ──> package ──(verify-jp HARD gate)
ui:     companyLabel(operator) + dedup ─┐
        lineLabel snippet (one flex unit, min-width:0 ellipsis):  [co][logo][name (roma)]
        compact spots (search hit, picked-station):  [co][badge] name   + ellipsis CSS
        popup.ts row.company → escapeHtml() in the HTML string
```

## Design spec — LOCKED by /plan-design-review (8.5/10 → keeps the style)
Calibrated against DESIGN.md (JR-East emerald system, monochrome discipline).
- **Token:** company label = `var(--ink-muted)` (**#6B756F**, the system's "secondary text, labels" token). NOT emerald — monochrome rule keeps the one accent for ridden lines only. ~0.78em, normal weight. Contrast #6B756F-on-white ≈ 4.7:1 (AA pass for secondary text).
- **Hierarchy:** `[company(muted)] [logo(color anchor)] [name(primary ink)]` → eye reads *who → which line*. The colored logo stays the visual anchor; the grey company recedes; the name stays primary.
- **Truncation:** the label row is one flex unit, `min-width:0`; the **name** gets `text-overflow:ellipsis` + a `title` attr (full name on hover). Compact rows (`.hit-line` was `flex:none`) get `min-width:0` so the company prefix never shoves the station name offscreen.
- **De-dup:** suppress the company when the line name already leads with its brand (no `東急 東急東横線`).
- Emerald brand (header, stats, Wrapped) + map untouched.

```
Picker / shared-line picker (full label, one flex unit):
  JR東日本  [JY]  山手線 (Yamanote Line)      ← 東日本=#6B756F .78em · logo · name primary
  東急      [TY]  東横線 (Tōyoko Line)         ← dedup keeps 東急 once

Search hit (compact, station-first — line is secondary context):
  渋谷 (Shibuya)
  JR東日本 [JY] 山手線…                          ← muted prefix; name ellipsis when narrow

Hover popup row:   [JR東日本]  [JY]  山手線 (Yamanote Line)
```

## Tests
- `company.ts` units: JR/metro/municipal mappings, `大阪メトロ` (JP), legal-suffix strip, long-fallback case, dedup (`startsWith`), `undefined`/empty → `''`.
- `popup.ts`: row carries `company`; HTML includes it **escaped**; malicious-operator test (`<img onerror>` → escaped).
- Build: `verify-jp` hard-fails if any line lacks `operator`.
- Visual (browser spot-check, narrow width): search-hits + picked-station rows don't overflow; company truncates, station name stays visible.

## NOT in scope
- Bilingual/romaji company names (follow-up). Company-by filtering/grouping (field enables, UI separate). Operator marks/logos (≠ line logos).

## Lanes (split)
| Lane | Owner | Files | Depends on |
|---|---|---|---|
| L0: contract bump | steering (me) | src/contract/types.ts | — |
| L1: build operator + hard gate | Codex (engine) | pipeline/n02-ingest.ts, pipeline/verify-jp.ts, rebuild public/rail/jp-2025.json | L0 |
| L2: companyLabel + lineLabel UI + tests | Claude (experience) | src/lib/company.ts(+test), src/lib/map/popup.ts(+test), src/screens/MapView.svelte | L0; L1 to run/QA |

L1 (pipeline/) and L2 (src/) are disjoint → parallel after L0. Merge, build app, QA narrow-width, ship.

## Implementation Tasks
- [ ] **T1 (P1, CC ~3min)** — contract: `operator?: string` on RailLine. (steering)
- [ ] **T2 (P1, CC ~8min)** — n02-ingest `operator: raw.operator`; verify-jp hard-fail on missing; rebuild package. (Codex)
- [ ] **T3 (P1, CC ~12min)** — `src/lib/company.ts` (label map + strip + dedup helper) + unit test. (Claude)
- [ ] **T4 (P1, CC ~15min)** — popup.ts row+escaped HTML+test; MapView `lineLabel` snippet + compact-row company + muted/truncation CSS. (Claude)
- [ ] **T5 (P1, CC ~6min)** — build app, npm test, narrow-width browser spot-check. (Claude)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 5 issues, 0 critical gaps |
| Outside Voice | `codex exec` | Independent 2nd opinion | 1 | issues_found | 9 points; 7 absorbed |
| Design Review | `/plan-design-review` | UI/UX, keep style | 1 | clean | 8.5/10; token+truncation+title locked |

- **CODEX:** caught the badge-mutation wrap bug (→ `lineLabel` unit), compact-row overflow (→ truncation), redundant brand (→ dedup), JP-label inconsistency (→ 大阪メトロ), popup escaping, and verifier-should-hard-fail. All absorbed.
- **DESIGN:** rated 8.5/10. Locked the company to `var(--ink-muted)` #6B756F (system's secondary-label token, AA pass, monochrome discipline intact), name-ellipsis + `title` attr, dedup, brand untouched. No mockup board needed — a muted text prefix, fully on-system.
- **CROSS-MODEL:** Review proposed mutating `lineMark`; outside voice showed it's a badge, not a label unit. Resolved toward the outside voice — new `lineLabel` snippet as one truncating flex group.
- **VERDICT:** ENG + DESIGN CLEARED — ready to implement.

NO UNRESOLVED DECISIONS
