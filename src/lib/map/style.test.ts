import { describe, it, expect } from 'vitest';
import {
  buildBaseStyle,
  selectedLineSegmentIds,
  selectedLineStationIds,
  inFilter,
  HIGHLIGHT_LINE_LAYER,
  HIGHLIGHT_STATION_LAYER,
  SEGMENTS_LAYER,
  STATIONS_LAYER,
  ROMAJI_ATTRIBUTION,
} from './style';
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

describe('C1 selection highlight', () => {
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

  it('adds a RED highlight line layer ABOVE the base segments layer (red wins over emerald)', () => {
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [] });
    const layers = style.layers as Layer[];
    const ids = layers.map((l) => l.id);
    expect(ids).toContain(HIGHLIGHT_LINE_LAYER);
    expect(ids.indexOf(HIGHLIGHT_LINE_LAYER)).toBeGreaterThan(ids.indexOf(SEGMENTS_LAYER));
    const hl = layers.find((l) => l.id === HIGHLIGHT_LINE_LAYER)!;
    expect(hl.paint?.['line-color']).toBe('#E4002B');
  });

  it('adds a RED highlight station layer above the base station dots', () => {
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [] });
    const layers = style.layers as Layer[];
    const ids = layers.map((l) => l.id);
    expect(ids).toContain(HIGHLIGHT_STATION_LAYER);
    expect(ids.indexOf(HIGHLIGHT_STATION_LAYER)).toBeGreaterThan(ids.indexOf(STATIONS_LAYER));
  });

  it('the highlight layers start with an EMPTY filter (paint nothing until a line is picked)', () => {
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [] });
    const layers = style.layers as Layer[];
    const hl = layers.find((l) => l.id === HIGHLIGHT_LINE_LAYER)!;
    expect(hl.filter).toEqual(['in', ['get', 'segmentId'], ['literal', []]]);
  });

  it('seeds the highlight filter from selectedSegmentIds/selectedStationIds when provided', () => {
    const segIds = selectedLineSegmentIds(yamanote, STUB_PACKAGES);
    const stIds = selectedLineStationIds(yamanote, STUB_PACKAGES);
    const style = buildBaseStyle({
      packages: STUB_PACKAGES,
      litSegmentIds: [],
      selectedSegmentIds: segIds,
      selectedStationIds: stIds,
    });
    const layers = style.layers as Layer[];
    const hl = layers.find((l) => l.id === HIGHLIGHT_LINE_LAYER)!;
    expect(hl.filter).toEqual(['in', ['get', 'segmentId'], ['literal', segIds]]);
    const hs = layers.find((l) => l.id === HIGHLIGHT_STATION_LAYER)!;
    expect(hs.filter).toEqual(['in', ['get', 'stationId'], ['literal', stIds]]);
  });
});
