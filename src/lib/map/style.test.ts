import { describe, it, expect } from 'vitest';
import {
  buildBaseStyle,
  buildSegmentCollection,
  buildStationCollection,
  lineColorExpression,
  lineOpacityExpression,
  glowColorExpression,
  stationColorExpression,
  selectedLineSegmentIds,
  selectedLineStationIds,
  inFilter,
  DEFAULT_LINE_COLOR,
  UNRIDDEN_OPACITY,
  CASING_COLOR,
  SELECTION_CASING_LAYER,
  HIGHLIGHT_STATION_LAYER,
  SEGMENTS_LAYER,
  SEGMENTS_GLOW_LAYER,
  STATIONS_LAYER,
  ROMAJI_ATTRIBUTION,
} from './style';
import { tokens } from '../../design/tokens';
import { STUB_PACKAGES, JP_PACKAGE } from '../../fixtures/stubPackage';

describe('buildBaseStyle', () => {
  it('does NOT carry a glyphs:undefined key (MapLibre rejects it and blanks the map)', () => {
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [] });
    // The key must be ABSENT, not present-with-undefined. MapLibre's validator emits
    // "glyphs: string expected, undefined found" and fires map 'error' before 'load',
    // leaving the map stuck blank. (Regression: that shipped in cycle 2.)
    expect('glyphs' in style).toBe(false);
    expect('sprite' in style).toBe(false);
  });

  it('is a v8 style: rail data as geojson + a muted raster basemap, with layers', () => {
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [] });
    expect(style.version).toBe(8);
    const sources = style.sources as Record<string, { type: string }>;
    expect(sources['rp-segments'].type).toBe('geojson');
    expect(sources['rp-stations'].type).toBe('geojson');
    expect(sources['basemap'].type).toBe('raster'); // v0 OSM basemap under the rail
    expect((style.layers as unknown[]).length).toBeGreaterThan(0);
  });

  it('carries the OSM/ODbL romaji credit on the rail source attribution', () => {
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [] });
    const sources = style.sources as Record<string, { attribution?: string }>;
    expect(sources['rp-segments'].attribution).toContain(ROMAJI_ATTRIBUTION);
  });
});

interface Layer {
  id: string;
  type: string;
  filter?: unknown;
  paint?: Record<string, unknown>;
}

// ─────────────────────────── C1: static per-segment color ───────────────────────────

describe('C1 static per-segment line color', () => {
  it('emits a STATIC `color` feature prop per segment = its line.color', () => {
    const fc = buildSegmentCollection(STUB_PACKAGES);
    const yamanote = JP_PACKAGE.lines.find((l) => l.lineId === 'jr-yamanote')!;
    const f = fc.features.find((ft) => ft.properties.lineId === 'jr-yamanote')!;
    expect(f.properties.color).toBe(yamanote.color);
    expect(typeof f.properties.color).toBe('string');
    // every segment carries a color (never undefined)
    expect(fc.features.every((ft) => typeof ft.properties.color === 'string')).toBe(true);
  });

  it('falls back to DEFAULT_LINE_COLOR for a line with no color', () => {
    const pkg = structuredClone(JP_PACKAGE);
    pkg.lines.forEach((l) => delete l.color);
    const fc = buildSegmentCollection([pkg]);
    expect(fc.features.every((ft) => ft.properties.color === DEFAULT_LINE_COLOR)).toBe(true);
  });

  it('lineColorExpression is the static ["get","color"] (NOT a per-frame match)', () => {
    expect(lineColorExpression()).toEqual(['coalesce', ['get', 'color'], DEFAULT_LINE_COLOR]);
  });

  it('the base segments layer paints line-color off ["get","color"] (set once)', () => {
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [] });
    const layers = style.layers as Layer[];
    const base = layers.find((l) => l.id === SEGMENTS_LAYER)!;
    expect(base.paint?.['line-color']).toEqual(['coalesce', ['get', 'color'], DEFAULT_LINE_COLOR]);
  });
});

// ─────────────────────── C2: ridden = opacity + width + own-color glow ───────────────────────

describe('C2 ridden-state rides opacity + width (color stays static)', () => {
  it('lineOpacityExpression is 1 when lit, UNRIDDEN_OPACITY when not', () => {
    const expr = lineOpacityExpression(['jr-yamanote:0-1']);
    expect(expr).toEqual([
      'case',
      ['in', ['get', 'segmentId'], ['literal', ['jr-yamanote:0-1']]],
      1,
      UNRIDDEN_OPACITY,
    ]);
    expect(UNRIDDEN_OPACITY).toBeLessThan(1);
  });

  it('the base segments layer drives opacity by the lit set', () => {
    const lit = ['jr-yamanote:0-1'];
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: lit });
    const base = (style.layers as Layer[]).find((l) => l.id === SEGMENTS_LAYER)!;
    expect(base.paint?.['line-opacity']).toEqual(lineOpacityExpression(lit));
  });

  it('the glow paints in the LINE’S OWN color (not a hard-coded emerald)', () => {
    expect(glowColorExpression()).toEqual(['coalesce', ['get', 'color'], DEFAULT_LINE_COLOR]);
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [] });
    const glow = (style.layers as Layer[]).find((l) => l.id === SEGMENTS_GLOW_LAYER)!;
    expect(glow.paint?.['line-color']).toEqual(['coalesce', ['get', 'color'], DEFAULT_LINE_COLOR]);
    expect(glow.paint?.['line-color']).not.toBe(tokens.railLit);
  });
});

// ─────────────────────────── C3: dark casing selection underlay ───────────────────────────

describe('C3 selection = DARK casing underlay (not red, not white)', () => {
  const jp = JP_PACKAGE;
  const yamanote = jp.lines.find((l) => l.lineId === 'jr-yamanote')!;

  it('selectedLineSegmentIds returns every segment on the line (and [] for null)', () => {
    const ids = selectedLineSegmentIds(yamanote, STUB_PACKAGES);
    const expected = jp.segments.filter((s) => s.lineId === 'jr-yamanote').length;
    expect(ids.length).toBe(expected);
    expect(ids.every((id) => id.startsWith('jr-yamanote:'))).toBe(true);
    expect(selectedLineSegmentIds(null, STUB_PACKAGES)).toEqual([]);
  });

  it('selectedLineStationIds includes all of the selected line stations', () => {
    const ids = selectedLineStationIds(yamanote, STUB_PACKAGES);
    const stations = jp.stations.filter((s) => s.lineId === 'jr-yamanote');
    expect(ids.length).toBe(stations.length);
    expect(ids).toContain(stations[0].stationId);
    expect(selectedLineStationIds(null, STUB_PACKAGES)).toEqual([]);
  });

  it('inFilter builds an ["in", ["get",prop], ["literal", ids]] expression', () => {
    expect(inFilter('segmentId', ['a', 'b'])).toEqual(['in', ['get', 'segmentId'], ['literal', ['a', 'b']]]);
    expect(inFilter('stationId', [])).toEqual(['in', ['get', 'stationId'], ['literal', []]]);
  });

  it('adds a DARK casing layer BELOW the base segments (the underlay halo)', () => {
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [] });
    const layers = style.layers as Layer[];
    const ids = layers.map((l) => l.id);
    expect(ids).toContain(SELECTION_CASING_LAYER);
    // BELOW the base line so the line's own hue shows on top + the dark casing peeks around it.
    expect(ids.indexOf(SELECTION_CASING_LAYER)).toBeLessThan(ids.indexOf(SEGMENTS_LAYER));
    const casing = layers.find((l) => l.id === SELECTION_CASING_LAYER)!;
    // dark ink (tokens.ink), NOT white (invisible on the near-white basemap), NOT red.
    expect(casing.paint?.['line-color']).toBe(CASING_COLOR);
    expect(CASING_COLOR).toBe(tokens.ink);
    expect(casing.paint?.['line-color']).not.toBe('#FFFFFF');
    expect(casing.paint?.['line-color']).not.toBe('#E4002B');
  });

  it('the casing layer starts with an EMPTY filter (nothing until a line is picked)', () => {
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [] });
    const casing = (style.layers as Layer[]).find((l) => l.id === SELECTION_CASING_LAYER)!;
    expect(casing.filter).toEqual(['in', ['get', 'segmentId'], ['literal', []]]);
  });

  it('seeds the casing/station filters from selectedSegmentIds/selectedStationIds', () => {
    const segIds = selectedLineSegmentIds(yamanote, STUB_PACKAGES);
    const stIds = selectedLineStationIds(yamanote, STUB_PACKAGES);
    const style = buildBaseStyle({
      packages: STUB_PACKAGES,
      litSegmentIds: [],
      selectedSegmentIds: segIds,
      selectedStationIds: stIds,
    });
    const layers = style.layers as Layer[];
    const casing = layers.find((l) => l.id === SELECTION_CASING_LAYER)!;
    expect(casing.filter).toEqual(['in', ['get', 'segmentId'], ['literal', segIds]]);
    const hs = layers.find((l) => l.id === HIGHLIGHT_STATION_LAYER)!;
    expect(hs.filter).toEqual(['in', ['get', 'stationId'], ['literal', stIds]]);
  });

  it('the station highlight ring uses a dark casing stroke (above the base dots)', () => {
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [] });
    const layers = style.layers as Layer[];
    const ids = layers.map((l) => l.id);
    expect(ids.indexOf(HIGHLIGHT_STATION_LAYER)).toBeGreaterThan(ids.indexOf(STATIONS_LAYER));
    const hs = layers.find((l) => l.id === HIGHLIGHT_STATION_LAYER)!;
    expect(hs.paint?.['circle-stroke-color']).toBe(CASING_COLOR);
  });
});

// ─────────────────────────── C4: neutral station dots ───────────────────────────

describe('C4 neutral station dots (lightness, not hue)', () => {
  it('ridden dot = dark ink, unridden = light grey (no emerald hue)', () => {
    const expr = stationColorExpression(['jr-yamanote.0']) as unknown[];
    expect(expr[0]).toBe('case');
    expect(expr[2]).toBe(tokens.ink); // ridden = dark
    expect(expr[3]).toBe(tokens.railDim); // unridden = light grey
    expect(expr[2]).not.toBe(tokens.railLit); // NOT emerald — hue is reserved for lines
  });
});

// ─────────────────────────── C5: station group id on station features ───────────────────────────

describe('C5 station features carry stationGroupId (for the hover popup)', () => {
  it('emits stationGroupId for transfer stations that have one', () => {
    const fc = buildStationCollection([JP_PACKAGE]);
    // 新宿 on the Yamanote stub carries groupId 'g-shinjuku'.
    const shinjuku = fc.features.find(
      (f) => f.properties.lineId === 'jr-yamanote' && f.properties.name === '新宿',
    )!;
    expect(shinjuku.properties.stationGroupId).toBe('g-shinjuku');
  });

  it('omits stationGroupId for stations that have none (kept undefined, not null)', () => {
    const fc = buildStationCollection([JP_PACKAGE]);
    const kanda = fc.features.find(
      (f) => f.properties.lineId === 'jr-yamanote' && f.properties.name === '神田',
    )!;
    expect('stationGroupId' in kanda.properties).toBe(false);
  });
});
