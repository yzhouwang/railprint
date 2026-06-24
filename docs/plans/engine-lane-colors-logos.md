# Engine lane (Codex) — line colors + logos data

**Owner:** engine. **Touches:** `pipeline/`, `data/readings/`, `public/rail/jp-2025.json`, `public/rail/logos/`.
**Does NOT touch:** `src/` or `src/contract/types.ts` (steering bumps the contract; code against the fields below).

## Goal
Give each line an official **color** + (where it exists) a **logo**, sourced from Wikidata + OSM,
joined OPERATOR-AWARE, with an operator-default palette for the gaps. Feeds the experience lane's
multicolor map + hover→lines popup.

## Shared contract (steering-bumped — code against these)
```ts
interface RailLine { …; color?: string;  /* hex, ALWAYS set (sourced or operator-default) */
                          logo?: string;  /* path under /rail/logos/, only when sourced */ }
```
Plus a committed `public/rail/logo-credits.json`: `{ [lineId]: { src, license, author } }`.

## Coverage (measured): Wikidata 415/1145 lines have color (P465), 321 have logo (P154). Expect
~250-400 of our 594 matched after the operator-aware join; the rest get the operator-default color.

## Tasks

### E1 — FIX the line join to be operator-aware (also fixes the queued line-romaji collision)
`build-readings.ts:425` looks up Wikidata line labels by `g.name` ONLY, but N02 groups by operator+name
(`:270`). That mispaints duplicated names (中央線 → Osaka Metro). Make the line join key on
**(operator + name)**: match the Wikidata line whose ja label = our name AND whose operator (P137) maps
to our N02_004 (build an operator alias table). **Fail closed** (no value) on an ambiguous JP label with
no operator/QID disambiguation. This single fix applies to romaji + color + logo.

### E2 — color join
- Wikidata **P465** (sRGB hex) + OSM `colour` tag, via the operator-aware join → `RailLine.color`.
- **Operator-default palette:** a curated table keyed by EXACT N02_004 operator names (~20 majors +
  aliases) for lines with no sourced color. Every line ends with a color.
- **Shinkansen:** keep their own official colors; do NOT collapse all `N02_002==='1'` lines to a generic
  JR operator color.

### E3 — logo pipeline
- Wikidata **P154** → Commons file → resolve the image URL (Special:FilePath / thumb API).
- Download to `public/rail/logos/<lineId>.<svg|png>` (deterministic name; SVG-sanitize, or PNG-thumbnail
  at a max dimension, e.g. 64px). Skip absurdly large files.
- Write `public/rail/logo-credits.json` (per-logo src URL, license, author) — Commons P154 is NOT
  uniformly CC0; attribution is required. Set `RailLine.logo` to the asset path.
- Decide commit-vs-generate: commit the (small) logo set so the app has them statically.

### E4 — join + rebuild
Join color/logo into `n02-ingest.ts` (set `RailLine.color` always, `RailLine.logo` when present);
`build-jp.ts` loads the readings. Rebuild `public/rail/jp-2025.json`.

### E5 — verify-jp
Report: official-color coverage %, total-color coverage (= 100% with fallback), logo coverage %, and the
(now operator-aware) line-romaji coverage. Hard-fail only if total color < 100% or a color isn't a valid hex.

### E6 — tests
Operator-aware join (中央線 JR vs Osaka Metro get DIFFERENT colors); operator-default fallback; hex
validation; Shinkansen-keep-own-color; logo-credits manifest shape.

## Done
Package rebuilt: every line has `color`, sourced lines have `logo` + a credit entry, gate green, `npm test` green.
Report color/logo coverage + confirm 中央線 (JR East) and 中央線 (Osaka Metro) have different colors.
