// T6 map style — PURE builders for the MapLibre sources + the data-driven paint that
// distinguishes ridden vs unridden. NO maplibre import here (so this is safe to import in
// any context, incl. tests). MapView consumes these to construct the actual GL layers.
//
// DESIGN decision (do NOT use per-feature setFeatureState): ridden vs unridden is ONE
// data-driven style expression keyed off the live litSegmentIds array. We update it with
// map.setPaintProperty(...) whenever the lit set changes. Colorblind-safe: ridden is
// THICKER (4px) not just greener (2px) — deuteranopia reads the network by thickness.

import type { RailGeoPackage, RailSegment, RailStation } from '../../contract/types';
import { tokens, stroke } from '../../design/tokens';

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
  seq: number;
}

export type SegmentCollection = GeoJSON.FeatureCollection<GeoJSON.LineString, SegmentFeatureProps>;
export type StationCollection = GeoJSON.FeatureCollection<GeoJSON.Point, StationFeatureProps>;

export const SEGMENTS_SOURCE = 'rp-segments';
export const STATIONS_SOURCE = 'rp-stations';
export const SEGMENTS_LAYER = 'rp-segments-line';
export const SEGMENTS_GLOW_LAYER = 'rp-segments-glow';
export const STATIONS_LAYER = 'rp-stations-dot';

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
        properties: { stationId: st.stationId, lineId: st.lineId, name: st.name, seq: st.seq },
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
// v0 has NO external basemap tiles (DESIGN defers basemap polish — the rail network IS
// the map). Just a mint/white background + our GeoJSON layers. $0, fully self-contained,
// offline-capable. The shape is `maplibregl.StyleSpecification` but we keep it untyped
// here so style.ts imports nothing from maplibre.

export interface BaseStyleInput {
  packages: RailGeoPackage[];
  litSegmentIds: string[];
}

export function buildBaseStyle({ packages, litSegmentIds: lit }: BaseStyleInput): Record<string, unknown> {
  const litStations = litStationIds(lit, packages);
  return {
    version: 8,
    // No glyphs/sprite: we render no symbol text in v0. The `glyphs` key is OMITTED
    // entirely — MapLibre's validator rejects `glyphs: undefined` ("string expected,
    // undefined found"), which fired map 'error' before 'load' and blanked the map.
    sources: {
      [SEGMENTS_SOURCE]: { type: 'geojson', data: buildSegmentCollection(packages) },
      [STATIONS_SOURCE]: { type: 'geojson', data: buildStationCollection(packages) },
    },
    layers: [
      { id: 'rp-bg', type: 'background', paint: { 'background-color': tokens.white } },
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
    for (const st of pkg.stations as RailStation[]) consider(st.lon, st.lat);
  }
  if (!any) return null;
  return [
    [w, s],
    [e, n],
  ];
}
