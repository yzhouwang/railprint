// T6 map style — PURE builders for the MapLibre sources + the data-driven paint that
// distinguishes ridden vs unridden. NO maplibre import here (so this is safe to import in
// any context, incl. tests). MapView consumes these to construct the actual GL layers.
//
// DESIGN decision (do NOT use per-feature setFeatureState): ridden vs unridden is ONE
// data-driven style expression keyed off the live litSegmentIds array. We update it with
// map.setPaintProperty(...) whenever the lit set changes. Colorblind-safe: ridden is
// THICKER (4px) not just greener (2px) — deuteranopia reads the network by thickness.

import type { RailGeoPackage, RailLine, RailSegment } from '../../contract/types';
import { tokens, stroke } from '../../design/tokens';

/**
 * CC BY 4.0 credit for the rail network data (MLIT N02). REQUIRED to be visible — surfaced
 * via the map's attribution control. Mirrors `N02_ATTRIBUTION` in pipeline/n02-ingest.ts.
 */
export const RAIL_ATTRIBUTION =
  '鉄道データ: 国土数値情報（N02）2025年度版（国土交通省）を加工して作成（CC BY 4.0）';

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
}
export interface StationFeatureProps {
  stationId: string;
  lineId: string;
  name: string;
  nameRoma?: string; // C5 popup reads this for the bilingual label (日本語 + romaji)
  seq: number;
}

export type SegmentCollection = GeoJSON.FeatureCollection<GeoJSON.LineString, SegmentFeatureProps>;
export type StationCollection = GeoJSON.FeatureCollection<GeoJSON.Point, StationFeatureProps>;

export const SEGMENTS_SOURCE = 'rp-segments';
export const STATIONS_SOURCE = 'rp-stations';
export const SEGMENTS_LAYER = 'rp-segments-line';
export const SEGMENTS_GLOW_LAYER = 'rp-segments-glow';
export const STATIONS_LAYER = 'rp-stations-dot';
// C1 — the SELECTION highlight. A dedicated red line + red station layer sit ABOVE the base
// segments so a selected line wins over emerald even when it is also ridden. They are driven by
// a setFilter on the selected ids (NOT setFeatureState — same data-driven design rule), and are
// empty (filter matches nothing) until a line is selected.
export const HIGHLIGHT_LINE_LAYER = 'rp-segments-highlight';
export const HIGHLIGHT_STATION_LAYER = 'rp-stations-highlight';

/** The transient selection red — outside the emerald monochrome on purpose (it is not coverage). */
export const HIGHLIGHT_COLOR = '#E4002B';

/** A maplibre filter that matches a feature whose `prop` is in `ids` (empty ⇒ matches nothing). */
export function inFilter(prop: 'segmentId' | 'stationId', ids: string[]): unknown[] {
  return ['in', ['get', prop], ['literal', ids]];
}

/** One LineString feature per RailSegment across ALL loaded packages. */
export function buildSegmentCollection(packages: RailGeoPackage[]): SegmentCollection {
  const features: GeoJSON.Feature<GeoJSON.LineString, SegmentFeatureProps>[] = [];
  for (const pkg of packages) {
    for (const seg of pkg.segments) {
      features.push({
        type: 'Feature',
        id: seg.segmentId,
        geometry: seg.geometry,
        properties: { segmentId: seg.segmentId, lineId: seg.lineId, isHSR: seg.isHSR },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** One Point feature per RailStation across ALL loaded packages. */
export function buildStationCollection(packages: RailGeoPackage[]): StationCollection {
  const features: GeoJSON.Feature<GeoJSON.Point, StationFeatureProps>[] = [];
  for (const pkg of packages) {
    for (const st of pkg.stations) {
      features.push({
        type: 'Feature',
        id: st.stationId,
        geometry: { type: 'Point', coordinates: [st.lon, st.lat] },
        properties: {
          stationId: st.stationId,
          lineId: st.lineId,
          name: st.name,
          ...(st.nameRoma ? { nameRoma: st.nameRoma } : {}),
          seq: st.seq,
        },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

// ───────────────────────── data-driven paint expressions ─────────────────────────
// We pass the lit segmentId array as an inline ['literal', [...]] and key the case
// expression off the feature's segmentId. One expression, swapped via setPaintProperty.

/** True iff the feature's segmentId is in `litArray`. */
function isLit(litArray: string[]): unknown[] {
  return ['in', ['get', 'segmentId'], ['literal', litArray]];
}

/** Ridden = emerald (railLit); unridden = grey (railDim). Hue alone is NOT the signal. */
export function lineColorExpression(litArray: string[]): unknown[] {
  return ['case', isLit(litArray), tokens.railLit, tokens.railDim];
}

/**
 * Ridden = 4px, unridden = 2px (DESIGN.md stroke tokens). THICKNESS is the colorblind-safe
 * differentiator. Width also scales gently with zoom so the network reads at JP-fit zoom
 * and stays legible zoomed-in.
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

/** Soft luminous halo under ridden lines only (the "glow"); zero width when unridden. */
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
export function litStationIds(litSegmentIds: string[], packages: RailGeoPackage[]): string[] {
  const litSet = new Set(litSegmentIds);
  const byId = new Map<string, RailSegment>();
  for (const pkg of packages) for (const s of pkg.segments) byId.set(s.segmentId, s);
  const stations = new Set<string>();
  for (const id of litSet) {
    const seg = byId.get(id);
    if (!seg) continue;
    stations.add(seg.fromStationId);
    stations.add(seg.toStationId);
  }
  return [...stations].sort();
}

// ───────────────────────── selection highlight (C1) ──────────────────────────
// Mirror litStationIds, but keyed off a SELECTED line rather than the ridden set. The MapView
// feeds these arrays to setFilter on the red highlight layers when a line is picked/inferred.

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

export function stationColorExpression(litStationArray: string[]): unknown[] {
  return [
    'case',
    ['in', ['get', 'stationId'], ['literal', litStationArray]],
    tokens.railLit,
    tokens.railDim,
  ];
}
export function stationRadiusExpression(litStationArray: string[]): unknown[] {
  // Ridden dots a touch larger (reinforces thickness-not-just-hue). Scales with zoom.
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    5,
    ['case', ['in', ['get', 'stationId'], ['literal', litStationArray]], 2.4, 1.4],
    12,
    ['case', ['in', ['get', 'stationId'], ['literal', litStationArray]], 5, 3],
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
      {
        id: SEGMENTS_GLOW_LAYER,
        type: 'line',
        source: SEGMENTS_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': tokens.railLit,
          'line-width': glowWidthExpression(lit),
          'line-opacity': glowOpacityExpression(lit),
          'line-blur': 4,
        },
      },
      {
        id: SEGMENTS_LAYER,
        type: 'line',
        source: SEGMENTS_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': lineColorExpression(lit),
          'line-width': lineWidthExpression(lit),
        },
      },
      // C1 — RED selection highlight ABOVE the base segments, so the picked line wins over
      // emerald even when it's also ridden. Empty filter ⇒ paints nothing until a line is
      // selected; MapView swaps the filter via setFilter (no setFeatureState — design rule).
      {
        id: HIGHLIGHT_LINE_LAYER,
        type: 'line',
        source: SEGMENTS_SOURCE,
        filter: inFilter('segmentId', selected),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': HIGHLIGHT_COLOR,
          // A touch thicker than ridden (4px) so the selection reads on top of a lit line.
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            4, stroke.ridden * 0.7,
            9, stroke.ridden + 1,
            14, stroke.ridden * 1.8,
          ],
        },
      },
      {
        id: STATIONS_LAYER,
        type: 'circle',
        source: STATIONS_SOURCE,
        paint: {
          'circle-color': stationColorExpression(litStations),
          'circle-radius': stationRadiusExpression(litStations),
          'circle-stroke-color': tokens.white,
          'circle-stroke-width': 1,
        },
      },
      // C1 — RED selection station dots above the base dots (same setFilter mechanism).
      {
        id: HIGHLIGHT_STATION_LAYER,
        type: 'circle',
        source: STATIONS_SOURCE,
        filter: inFilter('stationId', selectedStations),
        paint: {
          'circle-color': HIGHLIGHT_COLOR,
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            5, 2.8,
            12, 5.5,
          ],
          'circle-stroke-color': tokens.white,
          'circle-stroke-width': 1.5,
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
