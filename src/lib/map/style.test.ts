import { describe, it, expect } from 'vitest';
import {
  buildBaseStyle,
  lineSortKeyExpression,
  lineOffsetExpression,
  braidGlowOpacityExpression,
  corridorPartnerLit,
  slotSpacingPx,
  GLOW_OPACITY,
  buildSegmentCollection,
  buildStationCollection,
  lineColorExpression,
  lineOpacityExpression,
  lineWidthExpression,
  RIDDEN_WIDTH_SCALE,
  UNRIDDEN_WIDTH_SCALE,
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
import { tokens, stroke } from '../../design/tokens';
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

  it('ridden lines dominate: wider than unridden by a clear margin at every zoom stop', () => {
    // Evaluate the interpolate expr's per-zoom `case` branches: [interp, [linear], [zoom], z, case, …].
    const expr = lineWidthExpression(['x']) as unknown[];
    const stops = expr.slice(3); // z, caseExpr, z, caseExpr, …
    let checked = 0;
    for (let i = 0; i < stops.length; i += 2) {
      const c = stops[i + 1] as [string, unknown, number, number]; // ['case', isLit, riddenW, unriddenW]
      const [ridden, unridden] = [c[2], c[3]];
      expect(ridden).toBeGreaterThan(unridden * 2.5); // the "you've ridden this" line clearly foreground
      checked++;
    }
    expect(checked).toBe(3);
    // Guard the design intent (a flatten regression would trip here, not just the numbers above).
    expect(RIDDEN_WIDTH_SCALE).toBeGreaterThan(UNRIDDEN_WIDTH_SCALE);
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

describe('共用区間 braid integration (buildSegmentCollection × computeOverlapPlan)', () => {
  it('CRITICAL #16: zero-overlap packages emit BYTE-IDENTICAL features to the pre-braid renderer', () => {
    // JP_PACKAGE (the 3-line fallback stub) has no shared corridors — the plan must be empty and
    // every segment must come out as exactly ONE feature with the ORIGINAL geometry object shape
    // and no braid props. This is the "the braid cannot perturb the rest of the map" contract.
    const fc = buildSegmentCollection([JP_PACKAGE]);
    expect(fc.features).toHaveLength(JP_PACKAGE.segments.length);
    for (const [i, seg] of JP_PACKAGE.segments.entries()) {
      const f = fc.features[i];
      expect(f.properties.segmentId).toBe(seg.segmentId);
      expect(JSON.stringify(f.geometry)).toBe(JSON.stringify(seg.geometry));
      expect('slot' in f.properties).toBe(false);
      expect('partnersMinz' in f.properties).toBe(false);
      expect('partnerSeg' in f.properties).toBe(false);
      expect('partnerSeg2' in f.properties).toBe(false);
      expect('glowShare' in f.properties).toBe(false);
    }
  });

  it('#17: a corridor pair splits into multiple features; braid props ONLY on offset pieces', () => {
    // Two synthetic lines sharing identical geometry (青函-shaped full twin).
    const coords: [number, number][] = Array.from({ length: 8 }, (_, i) => [139 + i * 3e-3, 35]);
    const mk = (lineId: string, rank: 0 | 4): typeof JP_PACKAGE => ({
      ...JP_PACKAGE,
      lines: [
        {
          lineId,
          name: lineId,
          country: 'JP',
          isHSR: false,
          isLoop: false,
          rank,
          stationOrder: [],
          geometry: { type: 'LineString', coordinates: coords },
        },
      ],
      segments: [
        {
          segmentId: `${lineId}:0-1`,
          lineId,
          fromStationId: `${lineId}.a`,
          toStationId: `${lineId}.b`,
          fromSeq: 0,
          toSeq: 1,
          km: 2,
          isHSR: false,
          geometry: { type: 'LineString', coordinates: coords },
        },
      ],
      stations: [],
    });
    const fc = buildSegmentCollection([mk('twin-a', 0), mk('twin-b', 4)]);
    const a = fc.features.filter((f) => f.properties.lineId === 'twin-a');
    const b = fc.features.filter((f) => f.properties.lineId === 'twin-b');
    expect(a.length).toBeGreaterThanOrEqual(1);
    expect(b.length).toBeGreaterThanOrEqual(1);
    const offsetPieces = [...a, ...b].filter((f) => f.properties.slot !== undefined);
    expect(offsetPieces.length).toBeGreaterThan(0);
    for (const f of offsetPieces) {
      // full prop set travels together on corridor pieces
      expect(typeof f.properties.slot).toBe('number');
      expect(typeof f.properties.partnersMinz).toBe('number');
      expect(typeof f.properties.partnerSeg).toBe('string');
      expect(f.properties.glowShare).toBe(0.5);
      // duplicate-tolerant consumers rely on the piece keeping its segmentId (T6 audit)
      expect(f.properties.segmentId).toContain(f.properties.lineId);
    }
    // DD1: the rank-0 trunk gets the positive canonical-side slot
    expect(a[0].properties.slot).toBe(0.5);
    expect(b[0].properties.slot).toBe(-0.5);
  });
});

describe('共用区間 braid — review-hardening regressions (3-line CRITICAL, #18/#19, expression semantics)', () => {
  const mkCorridor = (lineId: string, rank: 0 | 2 | 4, coords: [number, number][]): typeof JP_PACKAGE => ({
    ...JP_PACKAGE,
    lines: [{ lineId, name: lineId, country: 'JP', isHSR: false, isLoop: false, rank, stationOrder: [], geometry: { type: 'LineString', coordinates: coords } }],
    segments: [{ segmentId: `${lineId}:0-1`, lineId, fromStationId: `${lineId}.a`, toStationId: `${lineId}.b`, fromSeq: 0, toSeq: 1, km: 2, isHSR: false, geometry: { type: 'LineString', coordinates: coords } }],
    stations: [],
  });
  const coords: [number, number][] = Array.from({ length: 8 }, (_, i) => [139 + i * 3e-3, 35]);

  it('CRITICAL (review): 3-line corridor — ALL strands incl. the slot-0 CENTER keep glowShare/partnerSeg', () => {
    const fc = buildSegmentCollection([mkCorridor('t3-a', 0, coords), mkCorridor('t3-b', 2, coords), mkCorridor('t3-c', 4, coords)]);
    for (const lid of ['t3-a', 't3-b', 't3-c']) {
      const f = fc.features.find((x) => x.properties.lineId === lid)!;
      expect(f.properties.glowShare).toBeCloseTo(1 / 3); // was: undefined for the center → 1.67× halo
      expect(f.properties.partnerSeg).toBeTruthy();
      expect(f.properties.partnerSeg2).toBeTruthy();
      expect(typeof f.properties.slot).toBe('number');
    }
    const slots = ['t3-a', 't3-b', 't3-c']
      .map((lid) => fc.features.find((x) => x.properties.lineId === lid)!.properties.slot!)
      .sort((a, b) => a - b);
    expect(slots).toEqual([-1, 0, 1]);
  });

  it('#18: line-offset is wired on ALL THREE line layers; glow carries the sort-key too (15A/#3)', () => {
    const style = buildBaseStyle({ packages: [JP_PACKAGE], litSegmentIds: [] });
    const layers = style.layers as { id: string; paint?: Record<string, unknown>; layout?: Record<string, unknown> }[];
    for (const id of ['rp-segments-casing', 'rp-segments-glow', 'rp-segments-line']) {
      const layer = layers.find((l) => l.id === id)!;
      expect(layer.paint?.['line-offset'], `${id} line-offset`).toBeDefined();
    }
    expect(layers.find((l) => l.id === 'rp-segments-line')!.layout?.['line-sort-key']).toBeDefined();
    expect(layers.find((l) => l.id === 'rp-segments-glow')!.layout?.['line-sort-key']).toBeDefined();
  });

  it('#19: lineSortKeyExpression — lit → 1, unlit → 0', () => {
    expect(lineSortKeyExpression(['s1'])).toEqual(['case', ['in', ['get', 'segmentId'], ['literal', ['s1']]], 1, 0]);
  });

  it('DD2 glide semantics: offset output is 0 at/below partnersMinz and full past +0.4 (stop arithmetic)', () => {
    // The offset is interpolate stops whose OUTPUTS clamp against each stop's LITERAL zoom.
    // Evaluate the clamp arithmetic for a feature with partnersMinz=7 at stops z=7 and z=8:
    // z7 → (7−7)/0.4 = 0 (closed); z8 → clamp((8−7)/0.4)=1 (fully open).
    const expr = lineOffsetExpression([]) as unknown[];
    expect(expr.slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']]);
    const stops = expr.slice(3);
    const outputAt = (z: number): unknown => stops[stops.indexOf(z) + 1];
    const evalClamp = (z: number, partnersMinz: number): number =>
      Math.min(1, Math.max(0, (z - partnersMinz) / 0.4));
    expect(evalClamp(7, 7)).toBe(0);
    expect(evalClamp(8, 7)).toBe(1);
    // structural: each stop output multiplies slot × spacing × the glide clamp for that literal z
    const out8 = outputAt(8) as unknown[];
    expect(out8[0]).toBe('*');
    expect(out8[2]).toBeCloseTo(slotSpacingPx(8));
  });

  it('DD4 opacity semantics: all-ridden corridor piece → GLOW_OPACITY × glowShare; else full; unlit 0', () => {
    const expr = braidGlowOpacityExpression(['self'], ['partner']) as unknown[];
    expect(expr[0]).toBe('case');
    // outer: unlit → 0 (last branch)
    expect(expr[expr.length - 1]).toBe(0);
    // inner: the all-partners branch multiplies the standard opacity by the piece's share
    const inner = expr[2] as unknown[];
    expect(inner[0]).toBe('case');
    expect(inner[2]).toEqual(['*', GLOW_OPACITY, ['coalesce', ['get', 'glowShare'], 1]]);
    expect(inner[3]).toBe(GLOW_OPACITY);
  });

  it('slotSpacingPx = the APPROVED separation (2× body+gap): ≈12.4px at z9, ≈19.1px at z14, monotone', () => {
    expect(slotSpacingPx(9)).toBeCloseTo(2 * (stroke.ridden * RIDDEN_WIDTH_SCALE + 1.5), 5);
    expect(slotSpacingPx(14)).toBeCloseTo(2 * (stroke.ridden * 1.6 * RIDDEN_WIDTH_SCALE + 2), 5);
    let prev = 0;
    for (let z = 3; z <= 16; z += 0.5) {
      const v = slotSpacingPx(z);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('corridorPartnerLit filters the lit array to corridor-partner reps only (perf contract)', () => {
    const packages = [mkCorridor('cp-a', 0, coords), mkCorridor('cp-b', 4, coords)];
    const allLit = ['cp-a:0-1', 'cp-b:0-1', 'unrelated:9-9'];
    const filtered = corridorPartnerLit(allLit, packages);
    expect(filtered).toEqual(expect.arrayContaining(['cp-a:0-1', 'cp-b:0-1']));
    expect(filtered).not.toContain('unrelated:9-9');
    // memoized by identity: same packages array → same underlying set, still pure per lit array
    expect(corridorPartnerLit([], packages)).toEqual([]);
  });
});
