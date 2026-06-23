import { describe, it, expect } from 'vitest';
import { resolveCoverage, segmentsBetween, coverageWarnings } from './resolver';
import { JP_PACKAGE, CN_PACKAGE, stationByName } from '../fixtures/stubPackage';
import type { RideEvent } from '../contract/types';

let counter = 0;
function ev(segmentId: string, over: Partial<RideEvent> = {}): RideEvent {
  return {
    id: `e${counter++}`,
    segmentId,
    railGeoVersion: JP_PACKAGE.version,
    source: 'manual',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

const sid = (pkg: typeof JP_PACKAGE, lineId: string, name: string): string =>
  stationByName(pkg, lineId, name).stationId;

describe('segmentsBetween', () => {
  it('returns consecutive segments in travel order on a non-loop line', () => {
    const a = sid(JP_PACKAGE, 'jr-kururi', '木更津');
    const c = sid(JP_PACKAGE, 'jr-kururi', '横田'); // seq 4
    const segs = segmentsBetween('jr-kururi', a, c, JP_PACKAGE);
    expect(segs).toEqual([
      'jr-kururi:0-1',
      'jr-kururi:1-2',
      'jr-kururi:2-3',
      'jr-kururi:3-4',
    ]);
  });

  it('is symmetric in segment set, reversed in order, for the opposite direction', () => {
    const a = sid(JP_PACKAGE, 'jr-kururi', '木更津');
    const c = sid(JP_PACKAGE, 'jr-kururi', '横田');
    const fwd = segmentsBetween('jr-kururi', a, c, JP_PACKAGE);
    const rev = segmentsBetween('jr-kururi', c, a, JP_PACKAGE);
    expect(new Set(rev)).toEqual(new Set(fwd));
    expect(rev).toEqual([...fwd].reverse());
  });

  it('treats the same station tapped twice as a no-op', () => {
    const a = sid(JP_PACKAGE, 'jr-kururi', '木更津');
    expect(segmentsBetween('jr-kururi', a, a, JP_PACKAGE)).toEqual([]);
  });

  it('throws when the two stations are not on the same line', () => {
    const kururi = sid(JP_PACKAGE, 'jr-kururi', '木更津');
    const yamaTokyo = sid(JP_PACKAGE, 'jr-yamanote', '東京');
    expect(() => segmentsBetween('jr-kururi', kururi, yamaTokyo, JP_PACKAGE)).toThrow();
  });

  it('throws on an unknown line', () => {
    const a = sid(JP_PACKAGE, 'jr-kururi', '木更津');
    expect(() => segmentsBetween('does-not-exist', a, a, JP_PACKAGE)).toThrow();
  });

  it('picks the SHORTER arc on a loop line', () => {
    // 東京 (seq 0) ↔ 有楽町 (seq 29, last): the wrap segment is one hop the short way.
    const tokyo = sid(JP_PACKAGE, 'jr-yamanote', '東京');
    const yurakucho = sid(JP_PACKAGE, 'jr-yamanote', '有楽町');
    const segs = segmentsBetween('jr-yamanote', tokyo, yurakucho, JP_PACKAGE);
    expect(segs).toEqual(['jr-yamanote:29-0']);
  });

  it('returns the shorter-by-km arc, contiguous from A to B, partitioning the loop', () => {
    const shinjuku = sid(JP_PACKAGE, 'jr-yamanote', '新宿');
    const tokyo = sid(JP_PACKAGE, 'jr-yamanote', '東京');
    const segs = segmentsBetween('jr-yamanote', shinjuku, tokyo, JP_PACKAGE);

    const kmById = new Map(JP_PACKAGE.segments.map((s) => [s.segmentId, s.km]));
    const allLoop = JP_PACKAGE.segments.filter((s) => s.lineId === 'jr-yamanote').map((s) => s.segmentId);
    const other = allLoop.filter((id) => !segs.includes(id));
    const km = (ids: string[]): number => ids.reduce((sum, id) => sum + kmById.get(id)!, 0);

    // The chosen arc is the shorter one, and the two arcs partition the whole loop.
    expect(km(segs)).toBeLessThanOrEqual(km(other));
    expect(new Set([...segs, ...other])).toEqual(new Set(allLoop));
    // Travel order: first segment touches 新宿, last touches 東京.
    const byId = new Map(JP_PACKAGE.segments.map((s) => [s.segmentId, s]));
    const first = byId.get(segs[0])!;
    const last = byId.get(segs[segs.length - 1])!;
    expect([first.fromStationId, first.toStationId]).toContain(shinjuku);
    expect([last.fromStationId, last.toStationId]).toContain(tokyo);
  });
});

describe('resolveCoverage — empty + edge', () => {
  it('is all-zero with no events and never produces NaN', () => {
    const r = resolveCoverage([], JP_PACKAGE);
    expect(r.riddenKm).toBe(0);
    expect(r.pctNational).toBe(0);
    expect(r.pctHSR).toBe(0);
    expect(r.litSegmentIds).toEqual([]);
    expect(r.prefectures).toBe(0);
    expect(Number.isNaN(r.pctNational)).toBe(false);
    expect(r.longestRide).toBeUndefined();
  });

  it('has a positive, stable national + HSR denominator', () => {
    const r = resolveCoverage([], JP_PACKAGE);
    expect(r.totalKm).toBeGreaterThan(0);
    expect(r.hsrTotalKm).toBeGreaterThan(0);
    expect(r.hsrTotalKm).toBeLessThan(r.totalKm);
  });
});

describe('resolveCoverage — counting', () => {
  it('sums precomputed km for a full single line and computes % against the national total', () => {
    const segs = JP_PACKAGE.segments.filter((s) => s.lineId === 'jr-kururi');
    const events = segs.map((s) => ev(s.segmentId));
    const r = resolveCoverage(events, JP_PACKAGE);
    const expectedKm = round2(segs.reduce((sum, s) => sum + s.km, 0));
    expect(r.riddenKm).toBe(expectedKm);
    expect(r.litSegmentIds).toEqual([...segs.map((s) => s.segmentId)].sort());
    expect(r.pctNational).toBeCloseTo((expectedKm / r.totalKm) * 100, 5);
    expect(r.mostRiddenLineId).toBe('jr-kururi');
  });

  it('is dupe-proof: riding a segment twice counts its km once', () => {
    const seg = JP_PACKAGE.segments.find((s) => s.lineId === 'jr-kururi')!;
    const once = resolveCoverage([ev(seg.segmentId)], JP_PACKAGE);
    const twice = resolveCoverage(
      [ev(seg.segmentId, { date: '2025-01-01' }), ev(seg.segmentId, { date: '2025-02-02' })],
      JP_PACKAGE,
    );
    expect(twice.riddenKm).toBe(once.riddenKm);
    expect(twice.litSegmentIds).toEqual(once.litSegmentIds);
  });

  it('counts undated events toward coverage', () => {
    const seg = JP_PACKAGE.segments.find((s) => s.lineId === 'jr-kururi')!;
    const r = resolveCoverage([ev(seg.segmentId, { date: undefined })], JP_PACKAGE);
    expect(r.riddenKm).toBeGreaterThan(0);
  });

  it('keeps the HSR % keyed off the HSR subset only', () => {
    const hsr = JP_PACKAGE.segments.filter((s) => s.isHSR).slice(0, 3);
    const r = resolveCoverage(
      hsr.map((s) => ev(s.segmentId)),
      JP_PACKAGE,
    );
    expect(r.hsrRiddenKm).toBeGreaterThan(0);
    expect(r.pctHSR).toBeCloseTo((r.hsrRiddenKm / r.hsrTotalKm) * 100, 5);
    // Those HSR km also count toward the national figure.
    expect(r.riddenKm).toBeCloseTo(r.hsrRiddenKm, 5);
  });

  it('counts multiple prefectures along a long HSR ride', () => {
    const tokaido = JP_PACKAGE.segments.filter((s) => s.lineId === 'jr-tokaido-shinkansen');
    const r = resolveCoverage(
      tokaido.map((s) => ev(s.segmentId)),
      JP_PACKAGE,
    );
    expect(r.prefectures).toBeGreaterThan(1);
  });

  it('ignores events whose segment is in a different package (cross-country isolation)', () => {
    const cnSeg = CN_PACKAGE.segments[0];
    const jrSeg = JP_PACKAGE.segments.find((s) => s.lineId === 'jr-kururi')!;
    const events = [ev(jrSeg.segmentId), ev(cnSeg.segmentId, { railGeoVersion: CN_PACKAGE.version })];
    const jp = resolveCoverage(events, JP_PACKAGE);
    const cn = resolveCoverage(events, CN_PACKAGE);
    expect(jp.litSegmentIds).toEqual([jrSeg.segmentId]);
    expect(cn.litSegmentIds).toEqual([cnSeg.segmentId]);
  });

  it('is deterministic — identical input ⇒ deep-equal output', () => {
    const segs = JP_PACKAGE.segments.slice(0, 5).map((s) => ev(s.segmentId));
    expect(resolveCoverage(segs, JP_PACKAGE)).toEqual(resolveCoverage(segs, JP_PACKAGE));
  });
});

describe('resolveCoverage — superlatives', () => {
  it('reports the longest ride from trip-grouped legs with its endpoints', () => {
    const tripId = 'trip-A';
    const a = JP_PACKAGE.segments.find((s) => s.segmentId === 'jr-tokaido-shinkansen:0-1')!;
    const b = JP_PACKAGE.segments.find((s) => s.segmentId === 'jr-tokaido-shinkansen:1-2')!;
    const events = [ev(a.segmentId, { tripId }), ev(b.segmentId, { tripId })];
    const r = resolveCoverage(events, JP_PACKAGE);
    expect(r.longestRide?.km).toBeCloseTo(round2(a.km + b.km), 5);
    const ends = [a.fromStationId, b.toStationId].sort();
    expect([r.longestRide?.fromStationId, r.longestRide?.toStationId]).toEqual(ends);
  });

  it('picks the fastest train model by known top speed', () => {
    const s1 = JP_PACKAGE.segments[0].segmentId;
    const s2 = JP_PACKAGE.segments[1].segmentId;
    const r = resolveCoverage(
      [ev(s1, { trainModel: 'N700S' }), ev(s2, { trainModel: 'E5系' })],
      JP_PACKAGE,
    );
    expect(r.fastestTrainModel).toBe('E5系'); // 320 > 285
  });

  it('leaves fastest model undefined for unknown models', () => {
    const r = resolveCoverage(
      [ev(JP_PACKAGE.segments[0].segmentId, { trainModel: 'おもちゃ' })],
      JP_PACKAGE,
    );
    expect(r.fastestTrainModel).toBeUndefined();
  });
});

describe('coverageWarnings', () => {
  it('warns once per mismatched rail-geo version, with a count', () => {
    const seg = JP_PACKAGE.segments[0].segmentId;
    const w = coverageWarnings(
      [
        ev(seg, { railGeoVersion: '2024.0.0' }),
        ev(JP_PACKAGE.segments[1].segmentId, { railGeoVersion: '2024.0.0' }),
      ],
      JP_PACKAGE,
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ eventVersion: '2024.0.0', packageVersion: JP_PACKAGE.version, count: 2 });
  });

  it('is silent when versions match', () => {
    const w = coverageWarnings([ev(JP_PACKAGE.segments[0].segmentId)], JP_PACKAGE);
    expect(w).toEqual([]);
  });

  it('flags an orphaned segment on a known line (re-sequenced/removed) rather than dropping it silently', () => {
    // jr-kururi is a line in the package, but :99-100 no longer resolves to a segment.
    const w = coverageWarnings([ev('jr-kururi:99-100', { railGeoVersion: '2024.0.0' })], JP_PACKAGE);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ kind: 'orphaned-segment', count: 1 });
  });

  it('does NOT warn about another package’s events (cross-country isolation)', () => {
    const cnSeg = CN_PACKAGE.segments[0].segmentId;
    expect(coverageWarnings([ev(cnSeg, { railGeoVersion: CN_PACKAGE.version })], JP_PACKAGE)).toEqual([]);
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
