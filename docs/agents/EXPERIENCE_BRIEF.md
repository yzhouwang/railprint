# Experience-lane integration brief (read this FIRST)

You are implementing one feature vertical of **RailPrint** (Opus 4.8 / experience lane).
The kernel, design system, and app shell are **already built and tested** — you plug into
them. Work ONLY inside the worktree at `/Users/yuzhouwang/train-experience` (absolute paths).
To run anything: `cd /Users/yuzhouwang/train-experience` first (its `node_modules` already
has `dexie`, `maplibre-gl`, `pmtiles`, `svelte`, `vitest`).

## Absolute rules
- **Never edit** `src/contract/types.ts` (frozen) or `src/design/tokens.ts` (owned). If a
  type is wrong, STOP and say so in your report.
- **Stay in your assigned files.** Do not touch the other verticals' files, `package.json`,
  configs, or the shared kernel/components/shell. They are fixed contracts you consume.
- **Do NOT `npm install`.** If you truly need a new dependency, STOP and report it.
- Do **not** run the whole-project `svelte-check` (other verticals may be mid-write). Verify
  your PURE logic with `npx vitest run <your test path>`. Trust integration check to the lead.
- Smallest correct change that meets DESIGN.md + the contract. No premature abstractions.
- Re-derive ZERO rail geometry at runtime: coverage km comes from `RailSegment.km`. Use
  `segmentsBetween` / `resolveCoverage` — never re-measure track.

## What already exists (consume, don't rebuild)

### Contract — `src/contract/types.ts` (read it)
`RailGeoPackage {version, generatedAt, crs:'WGS84', country, lines, segments, stations}`,
`RailLine {lineId, name, country, isHSR, isLoop, stationOrder[], geometry}`,
`RailSegment {segmentId:`${lineId}:${fromSeq}-${toSeq}`, lineId, fromStationId, toStationId, fromSeq, toSeq, km, isHSR, arcDirection?, geometry}`,
`RailStation {stationId, name, lineId, seq, lon, lat}`,
`RideEvent {id, segmentId, railGeoVersion, date?, trainModel?, source, tripId?, importBatchId?, createdAt}`,
`CoverageResult {riddenKm, totalKm, pctNational, hsrRiddenKm, hsrTotalKm, pctHSR, litSegmentIds[], prefectures, longestRide?, mostRiddenLineId?, fastestTrainModel?}`,
import types `ParsedRideRow`, `ImportReport`, `ImportResolution`, `MatchStatus`, and the
export schema constant `EXPORT_CSV_COLUMNS` (`'segmentId,lineId,railGeoVersion,rode,source,tripId,createdAt,date,trainModel'`).

### Store — `src/lib/store.ts` (Svelte `svelte/store` — use `$store` in markup, `get(store)` in TS)
Readable stores: `packages`, `events`, `ready`, `offline`, `geo` (GeoIndex), `coverages`
(`{pkg, result, warnings}[]`), `headline` (combined `{riddenKm,totalKm,pctNational,hsrRiddenKm,hsrTotalKm,pctHSR,prefectures,byCountry,hasRides}`), `litSegmentIds` (string[]).
`GeoIndex = {lineById, stationById, segmentById, linesByCountry, stationsByLine}` (all Maps;
`stationsByLine` values are seq-sorted).
Actions (async): `markRide({lineId, fromStationId, toStationId, pkg, date?, trainModel?, source?})`
→ `{added, sliceLength, tripId, segmentIds}` (added===0 ⇒ show the "この区間は記録済み" guard);
`addEvents(events)`, `replaceEvents(events)`, `removeImportBatch(id)`, `clearAllRides()`,
`requestPersistence()`, `loadPackages(pkgs)`.

### Resolver — `src/lib/resolver.ts`
`resolveCoverage(events, pkg) => CoverageResult` (pure), `segmentsBetween(lineId, fromId, toId, pkg) => string[]`
(throws if not same line; loop returns the shorter-by-km arc), `coverageWarnings(events, pkg)`.

### Other kernel
`src/lib/db.ts` (`newId()`, Dexie ops — usually go through the store), `src/lib/geo.ts`
(`haversineKm` — point distance only, fine for coord-proximity matching), `src/fixtures/stubPackage.ts`
(`JP_PACKAGE`, `CN_PACKAGE`, `STUB_PACKAGES`, `stationByName(pkg, lineId, name)`).

### UI — `src/lib/ui.ts`
`activeTab` ('map'|'stats'|'import'), `markMode` (bool), `toast(message, kind?, ttl?)`
(kind 'success'|'info'|'error'), `dismissToast`, `goToTab`. `src/lib/media.ts` → `isDesktop`.

### Design system (use these — do not restyle from scratch)
Components in `src/components/`: `Icon` (named SVGs, `IconName`), `Button`
(variant primary/secondary, `icon`, `full`, `onclick`), `Pill`, `Fab`, `ProgressBar`
(`value` 0..100), `FolderTabCard` (`label`), `StatCard` (`label?,pct,riddenKm,caption?`),
`TabBar`, `Diorama` (`variant 'train'|'board'`), `EmptyState`, `OfflineOverlay`, `Toasts`.
CSS variables (from tokens, set on :root): `--rail-lit`(#00A040 emerald-600), `--rail-text`
(#006B2D emerald-800), `--rail-dim`(#D7DEDA), `--rail-bg`(#EAF4EE mint), `--ink`, `--ink-muted`,
`--white`; `--space-xs..xxl`, `--radius-card|button|pill`, `--font-family`, `--weight-body|label|display`,
`--size-pct-hero|km|stat|body|label`. TS tokens: `import { tokens, stroke } from '../design/tokens'`.

### DESIGN.md rules (the bar)
Emerald **monochrome** (one hue; ridden = emerald, else grey/ink/mint). Folder-tab cards.
Glowing line: ridden = `--rail-lit` 4px, unridden = `--rail-dim` 2px — **colorblind-safe via
THICKNESS, not hue**. Station dots emerald(ridden)/grey(unridden). Contrast: emerald-600 only
for fills + display numbers **≥24px**; small emerald text/icons use emerald-800. Noto Sans JP.
44px touch targets, visible focus, ARIA landmarks. Motion = restrained (2–3 intentional beats).

## Svelte 5 (runes)
`<script lang="ts">` with `let { x, children }: Props = $props()`; reactivity via `$state`,
`$derived`, `$effect`; snippets via `{@render children()}` / `Snippet` type; events as props
(`onclick={...}`). Subscribe to stores in markup with `$store`; in TS use `get(store)`.

## Screen contract
Your screen file is a **prop-less default-export Svelte component** that reads the store. The
shell already imports it at its path; just replace the stub. Keep it working in a narrow
(380px) desktop side-panel AND full-screen mobile.
