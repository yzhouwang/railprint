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
  minzForRank,
  RANK_MINZOOM,
  stationMinzForLine,
  lodFilter,
  litStationIds,
} from './style';
import { tokens } from '../../design/tokens';
import { STUB_PACKAGES, JP_PACKAGE } from '../fallback-package';

describe('buildBaseStyle', () => {
  it('does NOT carry a glyphs:undefined key (MapLibre rejects it and blanks the map)', () => {
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [] });
    // The key must be ABSENT, not present-with-undefined. MapLibre's validator emits
    // "glyphs: string expected, undefined found" and fires map 'error' before 'load',
    // leaving the map stuck blank. (Regression: that shipped in cycle 2.)
    expect('glyphs' in style).toBe(false);
    expect('sprite' in style).toBe(false);
  });

  it('is a v8 style: rail data as geojson, basemap-less by default (offline fallback shape)', () => {
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [] });
    expect(style.version).toBe(8);
    const sources = style.sources as Record<string, { type: string }>;
    expect(sources['rp-segments'].type).toBe('geojson');
    expect(sources['rp-stations'].type).toBe('geojson');
    // No basemap given ⇒ rail over the plain rp-bg background, and NO external tile dependency
    // (the OSMF-policy-violating tile.openstreetmap.org raster is gone).
    expect(JSON.stringify(style)).not.toContain('tile.openstreetmap.org');
    expect((style.layers as { id: string }[])[0].id).toBe('rp-bg');
    expect((style.layers as unknown[]).length).toBeGreaterThan(0);
  });

  it('merges an external basemap: its sources/layers under the rail, glyphs+sprite adopted', () => {
    const basemap = {
      sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
      layers: [
        { id: 'background', type: 'background' },
        { id: 'water', type: 'fill', source: 'openmaptiles' },
      ],
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
    };
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [], basemap });
    expect(style.glyphs).toBe(basemap.glyphs);
    expect(style.sprite).toBe(basemap.sprite);
    const sources = style.sources as Record<string, { type: string }>;
    expect(sources['openmaptiles'].type).toBe('vector');
    expect(sources['rp-segments'].type).toBe('geojson'); // rail sources never clobbered
    const ids = (style.layers as { id: string }[]).map((l) => l.id);
    // order: rp-bg first, then the WHOLE basemap stack, then every rail layer above it.
    expect(ids[0]).toBe('rp-bg');
    expect(ids.indexOf('water')).toBeGreaterThan(ids.indexOf('background'));
    expect(ids.indexOf(SEGMENTS_LAYER)).toBeGreaterThan(ids.indexOf('water'));
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

describe('C9 zoom-tiered LOD (minz + lodFilter + adjacency memoize)', () => {
  it('minzForRank maps tier → reveal zoom; undefined ⇒ 0 (always visible)', () => {
    expect(RANK_MINZOOM).toEqual([3, 4, 5, 6, 7]);
    expect(minzForRank(0)).toBe(3); // Shinkansen — national
    expect(minzForRank(2)).toBe(5); // urban — region zoom
    expect(minzForRank(4)).toBe(7); // minor — city zoom
    expect(minzForRank(undefined)).toBe(0); // unranked (stub/CN) ⇒ never culled
  });

  it('buildSegmentCollection stamps minz from the line rank', () => {
    const pkg = structuredClone(JP_PACKAGE);
    pkg.lines.forEach((l) => { l.rank = l.lineId === 'jr-yamanote' ? 2 : 0; });
    const fc = buildSegmentCollection([pkg]);
    const yamanoteSeg = fc.features.find((f) => f.properties.lineId === 'jr-yamanote')!;
    expect(yamanoteSeg.properties.minz).toBe(5); // rank 2 (urban) → 5
  });

  it('lodFilter = show by tier OR any always-visible set (ridden, selected)', () => {
    const f = lodFilter('segmentId', ['a', 'b'], ['c']) as unknown[];
    expect(f[0]).toBe('any');
    expect(f[1]).toEqual(['>=', ['zoom'], ['get', 'minz']]); // the tier clause
    expect(f[2]).toEqual(['in', ['get', 'segmentId'], ['literal', ['a', 'b']]]); // ridden
    expect(f[3]).toEqual(['in', ['get', 'segmentId'], ['literal', ['c']]]); // selected
  });

  it('litStationIds is correct and memoizes the adjacency by package identity', () => {
    const pkgs = STUB_PACKAGES;
    const seg = JP_PACKAGE.segments[0];
    const a = litStationIds([seg.segmentId], pkgs);
    expect(a).toContain(seg.fromStationId);
    expect(a).toContain(seg.toStationId);
    // same array identity → cached path returns an equal result (no rebuild observable here,
    // but correctness must hold across calls)
    expect(litStationIds([seg.segmentId], pkgs)).toEqual(a);
    // a fresh array (post-fallback-retry swap) still resolves correctly
    expect(litStationIds([seg.segmentId], [...pkgs])).toEqual(a);
  });
});

describe('C9b station-dot LOD by average spacing', () => {
  it('dense lines hold their dots until zoomed in; sparse lines show them near the line', () => {
    // dense: ~1 km spacing, line shows at z7 → dots much later
    expect(stationMinzForLine(7, 30, 31)).toBeGreaterThan(7);
    // sparse: ~50 km spacing (Shinkansen), line at z4 → dots only a little later
    const shink = stationMinzForLine(4, 500, 11); // 50 km avg
    expect(shink).toBeGreaterThanOrEqual(4);
    expect(shink).toBeLessThan(8);
    // closer spacing reveals strictly later than wider spacing
    expect(stationMinzForLine(0, 10, 11)).toBeGreaterThan(stationMinzForLine(0, 100, 11)); // 1km vs 10km
  });

  it('never reveals dots before the line, never past the z14 cap, falls back for <2 stations', () => {
    expect(stationMinzForLine(9, 1000, 2)).toBeGreaterThanOrEqual(9); // floor at line minz
    expect(stationMinzForLine(0, 0.5, 100)).toBeLessThanOrEqual(14); // ultra-dense capped
    expect(stationMinzForLine(5, 0, 1)).toBe(5); // single station → line minz
    expect(stationMinzForLine(3, 0, 0)).toBe(3); // no stations → line minz
  });

  it('buildStationCollection: termini anchor at the line zoom, intermediates reveal later', () => {
    const pkg = structuredClone(JP_PACKAGE);
    const toyoko = pkg.lines.find((l) => l.lineId === 'tokyu-toyoko')!;
    toyoko.rank = 2; // line minz 5
    toyoko.isLoop = false;
    pkg.segments.forEach((s) => { if (s.lineId === 'tokyu-toyoko') s.km = 0.5; }); // very dense → dots late
    const fc = buildStationCollection([pkg]);
    const dots = fc.features.filter((f) => f.properties.lineId === 'tokyu-toyoko');
    const ends = new Set([toyoko.stationOrder[0], toyoko.stationOrder[toyoko.stationOrder.length - 1]]);
    for (const d of dots) {
      if (ends.has(d.properties.stationId)) expect(d.properties.minz).toBe(5); // terminus = line zoom
      else expect(d.properties.minz).toBeGreaterThan(5); // intermediate = later (density)
    }
  });
});
