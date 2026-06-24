# RailPrint geometry pipeline

Two pipelines live here. They are intentionally separate (see the eng review).

| Pipeline | Entry | Input | Output | Gate |
|---|---|---|---|---|
| **N02 ingest** (ships) | `n02-ingest.ts` | raw MLIT N02 GeoJSON | `public/rail/jp-2025.json` | `verify-jp.ts` |
| **Curated builder** | `build-package.ts` (`buildRailGeoPackage`) | hand-authored `LineBuildInput[]` | RailGeoPackage | `tests/geometry/*.test.ts` |

The ingest pipeline turns raw, messy national rail data (double-track, scrambled station
order, transfer-station id collisions, disconnected components) into a clean
`RailGeoPackage`. The curated builder expects already-clean input and is used by the toy
fixtures / future China corridor. Both target the same `src/contract/types.ts` contract.

## Regenerating the JP package

```bash
./scripts/fetch-n02.sh          # restore data/n02/*.json (gitignored, ~15MB, CC BY 4.0)
npm run build:rail-geo:jp       # → public/rail/jp-2025.json (committed artifact)
npm run verify:rail-geo:jp      # golden gate (also runs inside `npm test`)
```

`public/rail/jp-2025.json` is committed (it's the app's shipped dataset); the raw N02 inputs
are not. `npm test` runs `verify-jp.ts` against the committed artifact.

## How the ingest adapter works (`n02-ingest.ts`)

Per line, grouped by **(N02_004 operator + N02_003 line name)** — names are NOT unique
(JR East 山手線 ≠ 神戸市 山手線):

1. **graph** — section endpoints become nodes (near-miss clustered within ~12m so junctions
   digitized a few metres apart still connect); sections become weighted edges.
2. **spine** — the 2-sweep graph diameter of the largest component. On double-track this
   rides ONE track (Dijkstra takes the shorter parallel edge), so length ≈ real line km.
3. **bridge** — remaining disconnected components are chained on across gaps ≤ 3.5km, with a
   straight connector inserted at the PATH level only (never a graph edge, so the spine never
   routes coverage through synthetic track). Larger gaps (abolished sections) stay broken.
4. **loop** — real loops (大阪環状線) are told from double-track out-and-backs by the
   isoperimetric ratio `area / circ² > 0.04`.
5. **stations** — projected onto the spine by arc-length (monotonic / sequence-aware so a
   line passing near itself doesn't mis-project); deduped by id then name; `stationId` is
   **line-scoped** (`${lineId}:${N02_005g}`) with the shared group code kept in
   `stationGroupId`. A slice that collapses far below the station chord is repaired to the
   chord (honest km).
6. **HSR** — `isHSR = N02_002 === '1'` (JR Shinkansen).
7. **simplify** — Douglas–Peucker ~9m + coord rounding to 1e-5, AFTER km is computed.

### Verified accuracy

Every Shinkansen anchor matches official 営業キロ to <0.2% (東海道 515.1 vs 515.4, 東北
675.4 vs 674.9, …). The gate (`verify-jp.ts`) checks anchors, per-line detour, and the
under-length invariant. Known limitations: a few lines that are genuinely discontinuous in
reality (信越線/根室線 abolished sections) ship as their largest contiguous piece;
operator-split trunk lines (北陸新幹線 → JR East + JR West) appear as separate lines.

## Attribution

The data is **CC BY 4.0**. The required credit string is `N02_ATTRIBUTION` in
`n02-ingest.ts` and is surfaced in-app as a map credit:

> 出典「国土数値情報（鉄道データ N02）2025年度版」（国土交通省）を加工して作成
