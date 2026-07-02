// T6 map style — PURE builders for the MapLibre sources + the data-driven paint that
// distinguishes ridden vs unridden. NO maplibre import here (so this is safe to import in
// any context, incl. tests). MapView consumes these to construct the actual GL layers.
//
// HUE = each line's OFFICIAL color (identity), set ONCE as a STATIC per-segment `color`
// feature property (NOT a 594-line match rewritten per frame). Ridden-state rides OPACITY
// + THICKNESS only — never color: unridden = faded + desaturated + thin (2px); ridden =
// full official color + thick (4px) + a soft glow in the LINE'S OWN color. Colorblind-safe:
// ridden is THICKER, not just brighter (deuteranopia reads the network by thickness).
//
// DESIGN decision (do NOT use per-feature setFeatureState): ridden vs unridden is ONE
// data-driven style expression keyed off the live litSegmentIds array. `repaint()` updates
// the opacity + width channels only (via setPaintProperty); the base color is static per
// segment and never re-set.

import type { RailGeoPackage, RailLine, RailSegment } from '../../contract/types';
import { RAIL_ATTRIBUTION_JP } from '../../contract/types';
import { tokens, stroke } from '../../design/tokens';

/**
 * Fallback line color when a RailLine carries no `color` (the contract says it's ALWAYS
 * set, but the stub or a boundary-version package may omit it). A neutral mid-grey so an
 * uncolored line still reads as track, not as missing data.
 */
export const DEFAULT_LINE_COLOR = '#7C8A82';

/**
 * CC BY 4.0 credit for the rail network data (MLIT N02). REQUIRED to be visible — surfaced via the
 * map's attribution control. Sourced from the SHARED railnet contract (RAIL_ATTRIBUTION_JP) so the
 * app credit and the pipeline can never drift again (they had, before the contract owned this string).
 */
export const RAIL_ATTRIBUTION = RAIL_ATTRIBUTION_JP;

/**
 * Romanized station/line readings (nameRoma) are sourced from OpenStreetMap by the engine
 * lane and are ODbL-licensed — that credit MUST be visible wherever we surface romaji. Append
 * to the rail source attribution so it rides the same compact ⓘ control as the N02 + OSM credits.
 */
export const ROMAJI_ATTRIBUTION = 'Romanizations © OpenStreetMap contributors, ODbL';

// ─────────────────────────────── GeoJSON sources ────────────────────────────────

export interface SegmentFeatureProps {
  segmentId: string;
  lineId: string;
  isHSR: boolean;
  /** STATIC per-segment official line color (hex). The line hue keys off ['get','color']. */
  color: string;
  /** C9 LOD: the zoom this segment's line appears at (from RailLine.rank). 0 ⇒ always visible. */
  minz: number;
}
export interface StationFeatureProps {
  stationId: string;
  lineId: string;
  name: string;
  nameRoma?: string; // C5 popup reads this for the bilingual label (日本語 + romaji)
  /** Cross-line station group (N02_005g) — the hover popup keys geo.stationGroupById off it. */
  stationGroupId?: string;
  seq: number;
  /** C9 LOD: this station record's reveal zoom = its OWN line's minz. */
  minz: number;
}

// ───────────────────────────── C9 zoom-tiered LOD ─────────────────────────────
// Each line carries a RailLine.rank 0-4 (0 Shinkansen … 4 minor). We map rank → a reveal
// zoom and stamp it per segment/station as `minz`. The line + station layers then filter
// ['any', zoom>=minz, isRidden] — show by tier OR if you've ridden it (visible at every zoom).
// Lines with no rank (stub / non-JP boundary packages) default to minz 0 = always visible.
// Reveal zooms per rank. LINES load early and generously — stations are gated SEPARATELY by
// spacing (C9b), so a line showing early is just a clean stroke, not a cluttered dot-mess, which
// lets us be aggressive here: z3 Shinkansen, z4 trunk (both at the national view), urban/local/
// minor at z5/6/7 → the whole network is up by region/metro zoom. Was [4,6,7,8,9] (still too high).
export const RANK_MINZOOM = [3, 4, 5, 6, 7] as const;
export function minzForRank(rank: number | undefined): number {
  return rank == null ? 0 : (RANK_MINZOOM[rank] ?? 0);
}

// C9b — STATION dot LOD by AVERAGE SPACING. A line is readable well before its dots are: a dense
// line (山手線, subways ~1 km apart) crams ~30 dots into a tiny on-screen loop. So a dot reveals
// only once adjacent dots would clear ~STATION_DOT_GAP_PX on screen — derived from the line's mean
// inter-station distance. Web-mercator at ~lat 35°: km/px at zoom z = 40075·cosφ/(256·2^z), so a
// gap of G px needs 2^z ≥ G·40075/(256·cosφ·avgKm); STATION_LOD_K folds those constants.
const STATION_DOT_GAP_PX = 22;
const STATION_LOD_K = (STATION_DOT_GAP_PX * 40075.017) / (256 * Math.cos((35 * Math.PI) / 180));
const STATION_MINZ_CAP = 14; // never hold a dot past street zoom, however dense

/** Reveal zoom for a line's STATION dots from its mean spacing; never earlier than the line itself. */
export function stationMinzForLine(lineMinz: number, totalKm: number, stationCount: number): number {
  if (stationCount < 2 || totalKm <= 0) return lineMinz; // no spacing to reason about
  const avgSpacingKm = totalKm / (stationCount - 1);
  const byDensity = Math.round(Math.log2(STATION_LOD_K / avgSpacingKm));
  return Math.min(STATION_MINZ_CAP, Math.max(lineMinz, byDensity));
}

/** A maplibre membership test: feature's `prop` ∈ `ids` (empty ⇒ matches nothing). */
export function inLiteral(prop: string, ids: string[]): unknown[] {
  return ['in', ['get', prop], ['literal', ids]];
}

export type SegmentCollection = GeoJSON.FeatureCollection<GeoJSON.LineString, SegmentFeatureProps>;
export type StationCollection = GeoJSON.FeatureCollection<GeoJSON.Point, StationFeatureProps>;

export const SEGMENTS_SOURCE = 'rp-segments';
export const STATIONS_SOURCE = 'rp-stations';
export const SEGMENTS_LAYER = 'rp-segments-line';
export const SEGMENTS_GLOW_LAYER = 'rp-segments-glow';
export const STATIONS_LAYER = 'rp-stations-dot';
// C3 — the SELECTION highlight is a DARK CASING UNDERLAY (not the old red top-highlight, and
// NOT white — white is invisible on the near-white OSM basemap). It is a wide dark line that
// sits BELOW the base segments; the line's own official hue paints on top, so the dark halo
// peeking out around it reads as "selected". Driven by setFilter on the selected ids (NOT
// setFeatureState — design rule), empty (matches nothing) until a line is selected.
export const SELECTION_CASING_LAYER = 'rp-segments-casing';
// The selected line's stations get a dark ring above the base dots (same setFilter mechanism).
export const HIGHLIGHT_STATION_LAYER = 'rp-stations-highlight';

/** Dark casing color for the selection underlay — tokens.ink, visible on the light basemap. */
export const CASING_COLOR = tokens.ink;

/** A maplibre filter that matches a feature whose `prop` is in `ids` (empty ⇒ matches nothing). */
export function inFilter(prop: 'segmentId' | 'stationId', ids: string[]): unknown[] {
  return inLiteral(prop, ids);
}

/**
 * C9 — the LOD visibility filter: show a feature once the zoom reaches its tier (`minz`), OR if
 * it appears in any `alwaysVisible` set (the ridden set → your network shows at EVERY zoom; the
 * SELECTED line → you can see + tap it even zoomed out). maplibre-gl 5.24 filters accept
 * `['zoom']` mixed with feature data (verified in its source).
 */
export function lodFilter(idProp: 'segmentId' | 'stationId', ...alwaysVisible: string[][]): unknown[] {
  return ['any', ['>=', ['zoom'], ['get', 'minz']], ...alwaysVisible.map((ids) => inLiteral(idProp, ids))];
}

/**
 * One LineString feature per RailSegment across ALL loaded packages. Each feature carries a
 * STATIC `color` prop = its line's official `RailLine.color` (C1) so the line hue is a plain
 * ['get','color'] paint set ONCE — never a per-frame match. Lines lacking a color fall back to
 * DEFAULT_LINE_COLOR.
 */
export function buildSegmentCollection(packages: RailGeoPackage[]): SegmentCollection {
  const features: GeoJSON.Feature<GeoJSON.LineString, SegmentFeatureProps>[] = [];
  for (const pkg of packages) {
    const colorByLine = new Map<string, string>();
    const minzByLine = new Map<string, number>();
    for (const l of pkg.lines) {
      colorByLine.set(l.lineId, l.color ?? DEFAULT_LINE_COLOR);
      minzByLine.set(l.lineId, minzForRank(l.rank));
    }
    for (const seg of pkg.segments) {
      features.push({
        type: 'Feature',
        id: seg.segmentId,
        geometry: seg.geometry,
        properties: {
          segmentId: seg.segmentId,
          lineId: seg.lineId,
          isHSR: seg.isHSR,
          color: colorByLine.get(seg.lineId) ?? DEFAULT_LINE_COLOR,
          minz: minzByLine.get(seg.lineId) ?? 0,
        },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * One Point feature per RailStation across ALL loaded packages. Carries `stationGroupId` (C5)
 * so a hover can look up every line through the physical station via geo.stationGroupById.
 */
export function buildStationCollection(packages: RailGeoPackage[]): StationCollection {
  const features: GeoJSON.Feature<GeoJSON.Point, StationFeatureProps>[] = [];
  for (const pkg of packages) {
    // Per line: total track km (from segment km), the line's own reveal zoom, the spacing-derived
    // DOT reveal zoom, and the two TERMINI (ends of a non-loop line) which anchor at the line's zoom.
    const kmByLine = new Map<string, number>();
    for (const s of pkg.segments) kmByLine.set(s.lineId, (kmByLine.get(s.lineId) ?? 0) + s.km);
    const lineMinzByLine = new Map<string, number>();
    const dotMinzByLine = new Map<string, number>();
    const terminiByLine = new Map<string, Set<string>>();
    for (const l of pkg.lines) {
      const lineMinz = minzForRank(l.rank);
      const n = l.stationOrder.length;
      lineMinzByLine.set(l.lineId, lineMinz);
      dotMinzByLine.set(l.lineId, stationMinzForLine(lineMinz, kmByLine.get(l.lineId) ?? 0, n));
      if (!l.isLoop && n >= 2) terminiByLine.set(l.lineId, new Set([l.stationOrder[0], l.stationOrder[n - 1]]));
    }
    for (const st of pkg.stations) {
      const isTerminus = terminiByLine.get(st.lineId)?.has(st.stationId) ?? false;
      const minz = isTerminus
        ? (lineMinzByLine.get(st.lineId) ?? 0)
        : (dotMinzByLine.get(st.lineId) ?? 0);
      features.push({
        type: 'Feature',
        id: st.stationId,
        geometry: { type: 'Point', coordinates: [st.lon, st.lat] },
        properties: {
          stationId: st.stationId,
          lineId: st.lineId,
          name: st.name,
          ...(st.nameRoma ? { nameRoma: st.nameRoma } : {}),
          ...(st.stationGroupId ? { stationGroupId: st.stationGroupId } : {}),
          seq: st.seq,
          minz,
        },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

// ───────────────────────── data-driven paint expressions ─────────────────────────
// HUE is a STATIC per-segment property (`color`) — set once, never re-set. Ridden-state
// rides the OPACITY + WIDTH channels: those are the only paint props `repaint()` swaps via
// setPaintProperty, keyed off the live litSegmentIds array (passed inline as ['literal',…]).

/** True iff the feature's segmentId is in `litArray`. */
function isLit(litArray: string[]): unknown[] {
  return ['in', ['get', 'segmentId'], ['literal', litArray]];
}

/**
 * The line hue: the feature's STATIC official `color` (C1). Set ONCE on layer add and never
 * re-set per frame. `coalesce` guards a feature missing `color` (→ DEFAULT_LINE_COLOR).
 */
export function lineColorExpression(): unknown[] {
  return ['coalesce', ['get', 'color'], DEFAULT_LINE_COLOR];
}

/**
 * Ridden = full official color (opacity 1, 4px, glow); unridden = the official color at 0.7
 * so the lines READ as their colors even before you ride them (the whole point of the feature)
 * while ridden still pops via thickness + glow + the last bit of opacity. 0.35 washed the
 * colors out to invisible pastels on the light basemap (browser-verified). Opacity is one of
 * the two lit-keyed channels `repaint()` updates.
 */
export const UNRIDDEN_OPACITY = 0.7;
export function lineOpacityExpression(litArray: string[]): unknown[] {
  return ['case', isLit(litArray), 1, UNRIDDEN_OPACITY];
}

/**
 * Ridden = 4px, unridden = 2px (DESIGN.md stroke tokens). THICKNESS is the colorblind-safe
 * differentiator (opacity alone is not). Width also scales gently with zoom so the network
 * reads at JP-fit zoom and stays legible zoomed-in.
 */
export function lineWidthExpression(litArray: string[]): unknown[] {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    4,
    ['case', isLit(litArray), stroke.ridden * 0.6, stroke.unridden * 0.6],
    9,
    ['case', isLit(litArray), stroke.ridden, stroke.unridden],
    14,
    ['case', isLit(litArray), stroke.ridden * 1.6, stroke.unridden * 1.25],
  ];
}

/**
 * Soft luminous halo under ridden lines only (the "glow"), in the LINE'S OWN color (NOT a
 * hard-coded emerald) — so a ridden line glows in its identity hue. Zero width when unridden.
 */
export function glowColorExpression(): unknown[] {
  return ['coalesce', ['get', 'color'], DEFAULT_LINE_COLOR];
}
export function glowWidthExpression(litArray: string[]): unknown[] {
  return ['case', isLit(litArray), 11, 0];
}
export function glowOpacityExpression(litArray: string[]): unknown[] {
  return ['case', isLit(litArray), 0.18, 0];
}

/**
 * A station dot is "lit" when ANY segment touching it is ridden. We precompute the lit
 * station set from the lit segment set + the package adjacency, then key the dot color/
 * radius off ['in', stationId, litStations]. Emerald (ridden) vs grey (unridden).
 */
// P1 perf: the segment→{from,to} adjacency is STATIC per package set. `repaint()` runs up to
// 48× during an import flood; rebuilding this 9,442-entry map each time was the flagged O(n)
// landmine. Memoize by the `packages` ARRAY IDENTITY (a WeakMap, so a new array after the
// fallback-retry self-heal auto-invalidates — NOT keyed by version, which collides JP/CN stub).
const segmentIndexCache = new WeakMap<RailGeoPackage[], Map<string, RailSegment>>();
function segmentIndex(packages: RailGeoPackage[]): Map<string, RailSegment> {
  let byId = segmentIndexCache.get(packages);
  if (!byId) {
    byId = new Map<string, RailSegment>();
    for (const pkg of packages) for (const s of pkg.segments) byId.set(s.segmentId, s);
    segmentIndexCache.set(packages, byId);
  }
  return byId;
}

export function litStationIds(litSegmentIds: string[], packages: RailGeoPackage[]): string[] {
  const byId = segmentIndex(packages);
  const stations = new Set<string>();
  for (const id of litSegmentIds) {
    const seg = byId.get(id);
    if (!seg) continue;
    stations.add(seg.fromStationId);
    stations.add(seg.toStationId);
  }
  return [...stations].sort();
}

// ───────────────────────── selection highlight (C3) ──────────────────────────
// Mirror litStationIds, but keyed off a SELECTED line rather than the ridden set. The MapView
// feeds these arrays to setFilter on the dark casing + station-ring layers when a line is
// picked/inferred.

/** Every segmentId on the selected line (across packages — lineId is globally unique). */
export function selectedLineSegmentIds(line: RailLine | null, packages: RailGeoPackage[]): string[] {
  if (!line) return [];
  const ids: string[] = [];
  for (const pkg of packages) {
    for (const seg of pkg.segments) if (seg.lineId === line.lineId) ids.push(seg.segmentId);
  }
  return ids.sort();
}

/** Every stationId on the selected line — the red dots that ride above the base station layer. */
export function selectedLineStationIds(line: RailLine | null, packages: RailGeoPackage[]): string[] {
  if (!line) return [];
  const ids: string[] = [];
  for (const pkg of packages) {
    for (const st of pkg.stations) if (st.lineId === line.lineId) ids.push(st.stationId);
  }
  return ids.sort();
}

/**
 * C4 — NEUTRAL station dots. Hue is now reserved for LINES, so dots encode ridden by
 * LIGHTNESS, not by emerald/grey hue: ridden = dark ink, unridden = light grey. (A transfer
 * station's per-line colors live in the hover popup, not on the dot.)
 */
export function stationColorExpression(litStationArray: string[]): unknown[] {
  return ['case', inLiteral('stationId', litStationArray), tokens.ink, tokens.railDim];
}
export function stationRadiusExpression(litStationArray: string[]): unknown[] {
  // Ridden dots a touch larger (reinforces thickness-not-just-hue). Scales with zoom.
  const lit = inLiteral('stationId', litStationArray);
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    5,
    ['case', lit, 2.4, 1.4],
    12,
    ['case', lit, 5, 3],
  ];
}

// ─────────────────────────────── the base style ─────────────────────────────────
// A muted OSM raster basemap (so the network reads against real geography) under our
// GeoJSON rail layers. No glyphs/sprite/text. The shape is `maplibregl.StyleSpecification`
// but kept untyped here so style.ts imports nothing from maplibre.
// NOTE: the raster basemap reintroduces an external tile dependency the eng review
// flagged for offline/iOS — fine for this online-first v0; revisit for the PWA/offline tier.

export interface BaseStyleInput {
  packages: RailGeoPackage[];
  litSegmentIds: string[];
  /** Initial selection highlight (usually empty at boot; MapView drives it via setFilter). */
  selectedSegmentIds?: string[];
  selectedStationIds?: string[];
}

export function buildBaseStyle({
  packages,
  litSegmentIds: lit,
  selectedSegmentIds: selected = [],
  selectedStationIds: selectedStations = [],
}: BaseStyleInput): Record<string, unknown> {
  const litStations = litStationIds(lit, packages);
  return {
    version: 8,
    // No glyphs/sprite: we render no symbol text in v0. The `glyphs` key is OMITTED
    // entirely — MapLibre's validator rejects `glyphs: undefined` ("string expected,
    // undefined found"), which fired map 'error' before 'load' and blanked the map.
    sources: {
      // v0 raster basemap (muted) so the rail network reads against real geography.
      basemap: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        maxzoom: 19,
      },
      // The rail data CC BY credit rides on its own source so the attribution control shows
      // it alongside the OSM basemap credit (CC BY requires it to be visible). The OSM/ODbL
      // romaji credit is appended here too — it is the source of the nameRoma readings we surface.
      [SEGMENTS_SOURCE]: {
        type: 'geojson',
        data: buildSegmentCollection(packages),
        attribution: `${RAIL_ATTRIBUTION}｜${ROMAJI_ATTRIBUTION}`,
      },
      [STATIONS_SOURCE]: { type: 'geojson', data: buildStationCollection(packages) },
    },
    layers: [
      { id: 'rp-bg', type: 'background', paint: { 'background-color': tokens.white } },
      {
        id: 'rp-basemap',
        type: 'raster',
        source: 'basemap',
        // Mute toward soft grey so the emerald rail pops (JR-East aesthetic).
        paint: {
          'raster-saturation': -0.9,
          'raster-opacity': 0.55,
          'raster-contrast': -0.12,
          'raster-brightness-max': 0.98,
        },
      },
      // C3 — DARK SELECTION CASING, UNDERLAY: a wide dark line BELOW everything rail so the
      // picked line's dark halo peeks out around its own hue (white would vanish on the light
      // basemap). Empty filter ⇒ paints nothing until a line is selected; MapView swaps the
      // filter via setFilter (no setFeatureState — design rule).
      {
        id: SELECTION_CASING_LAYER,
        type: 'line',
        source: SEGMENTS_SOURCE,
        filter: inFilter('segmentId', selected),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': CASING_COLOR,
          // Wider than the base ridden line (4px) so the dark casing reads as a halo under it.
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            4, stroke.ridden * 1.4,
            9, stroke.ridden * 2,
            14, stroke.ridden * 2.6,
          ],
          'line-opacity': 0.9,
        },
      },
      // The "glow" — a soft halo under the RIDDEN lines, in each line's OWN official color.
      {
        id: SEGMENTS_GLOW_LAYER,
        type: 'line',
        source: SEGMENTS_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': glowColorExpression(),
          'line-width': glowWidthExpression(lit),
          'line-opacity': glowOpacityExpression(lit),
          'line-blur': 4,
        },
      },
      // The base rail line — STATIC official color (C1) + lit-keyed opacity + width (C2).
      // C9 LOD: only draw once zoom reaches the line's tier (minz) OR it's ridden/selected.
      {
        id: SEGMENTS_LAYER,
        type: 'line',
        source: SEGMENTS_SOURCE,
        filter: lodFilter('segmentId', lit, selected),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': lineColorExpression(),
          'line-opacity': lineOpacityExpression(lit),
          'line-width': lineWidthExpression(lit),
        },
      },
      {
        id: STATIONS_LAYER,
        type: 'circle',
        source: STATIONS_SOURCE,
        // C9 LOD: a dot appears when its line's tier (minz) is reached, OR if ridden/selected.
        filter: lodFilter('stationId', litStations, selectedStations),
        paint: {
          'circle-color': stationColorExpression(litStations),
          'circle-radius': stationRadiusExpression(litStations),
          'circle-stroke-color': tokens.white,
          'circle-stroke-width': 1,
        },
      },
      // C3 — dark selection ring on the picked line's stations, above the base dots.
      {
        id: HIGHLIGHT_STATION_LAYER,
        type: 'circle',
        source: STATIONS_SOURCE,
        filter: inFilter('stationId', selectedStations),
        paint: {
          'circle-color': tokens.white,
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            5, 2.8,
            12, 5.5,
          ],
          'circle-stroke-color': CASING_COLOR,
          'circle-stroke-width': 2,
        },
      },
    ],
  };
}

// ────────────────────────────────── bounds ──────────────────────────────────────

export type LngLatBounds = [[number, number], [number, number]]; // [[w,s],[e,n]]

/**
 * Tight bounds over every station across packages (fit-to-network on load). Returns null
 * if there are no stations. Pure — used by MapView's fitBounds and unit-testable.
 */
export function networkBounds(packages: RailGeoPackage[]): LngLatBounds | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  let any = false;
  const consider = (lon: number, lat: number): void => {
    any = true;
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  };
  for (const pkg of packages) {
    for (const st of pkg.stations) consider(st.lon, st.lat);
  }
  if (!any) return null;
  return [
    [w, s],
    [e, n],
  ];
}

/** Bounds over only the RIDDEN segments, so the default view frames where you've been. */
export function riddenBounds(
  litSegmentIds: string[],
  packages: RailGeoPackage[],
): LngLatBounds | null {
  const lit = new Set(litSegmentIds);
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  let any = false;
  for (const pkg of packages) {
    for (const seg of pkg.segments) {
      if (!lit.has(seg.segmentId)) continue;
      for (const [lon, lat] of seg.geometry.coordinates) {
        any = true;
        if (lon < w) w = lon;
        if (lon > e) e = lon;
        if (lat < s) s = lat;
        if (lat > n) n = lat;
      }
    }
  }
  return any ? [[w, s], [e, n]] : null;
}
