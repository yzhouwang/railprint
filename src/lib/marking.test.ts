import { describe, it, expect } from 'vitest';
import { SearchSeq, sameStation, classifyRoutes } from './marking';
import type { StationHit } from './search';
import type { RailGeoPackage, RailLine, RailSegment, RailStation } from '../contract/types';

// Minimal deterministic package builder (trimmed from route.test's packageFromLines) so the
// classifyRoutes cases don't depend on the evolving fixture's connectivity. Each line is a chain of
// stations keyed by group name; a shared group name across lines is a transfer.
interface LineDef {
  lineId: string;
  groups: string[];
  kms: number[];
}
function pkgFromLines(defs: LineDef[]): RailGeoPackage {
  const lines: RailLine[] = [];
  const stations: RailStation[] = [];
  const segments: RailSegment[] = [];
  for (const [di, def] of defs.entries()) {
    const lineStations = def.groups.map((group, seq): RailStation => ({
      stationId: `${def.lineId}.${seq}`,
      name: group,
      lineId: def.lineId,
      seq,
      lon: seq,
      lat: di,
      stationGroupId: group,
    }));
    stations.push(...lineStations);
    lines.push({
      lineId: def.lineId,
      name: def.lineId,
      country: 'JP',
      isHSR: false,
      isLoop: false,
      stationOrder: lineStations.map((s) => s.stationId),
      geometry: { type: 'LineString', coordinates: lineStations.map((s) => [s.lon, s.lat]) },
    });
    for (let i = 0; i < lineStations.length - 1; i++) {
      segments.push({
        segmentId: `${def.lineId}:${i}-${i + 1}`,
        lineId: def.lineId,
        fromStationId: lineStations[i].stationId,
        toStationId: lineStations[i + 1].stationId,
        fromSeq: i,
        toSeq: i + 1,
        km: def.kms[i],
        isHSR: false,
        geometry: {
          type: 'LineString',
          coordinates: [
            [lineStations[i].lon, lineStations[i].lat],
            [lineStations[i + 1].lon, lineStations[i + 1].lat],
          ],
        },
      });
    }
  }
  return { version: 'test-marking.1', generatedAt: '2026-07-02T00:00:00.000Z', crs: 'WGS84', country: 'JP', lines, segments, stations };
}
function hitOn(pkg: RailGeoPackage, lineId: string, group: string): StationHit {
  const line = pkg.lines.find((l) => l.lineId === lineId)!;
  const station = pkg.stations.find((s) => s.lineId === lineId && s.stationGroupId === group)!;
  return { station, line, score: 1, exact: true };
}

describe('SearchSeq — latest-wins guard for the async resolve (invariant 1a)', () => {
  it('a token is current immediately after next()', () => {
    const g = new SearchSeq();
    const t = g.next();
    expect(g.isCurrent(t)).toBe(true);
  });

  it('an out-of-order (superseded) resolve is dropped; only the latest token is current', () => {
    const g = new SearchSeq();
    const first = g.next(); // keystroke 1 starts resolving
    const second = g.next(); // keystroke 2 arrives before 1 resolves
    expect(g.isCurrent(first)).toBe(false); // 1's late resolve must be dropped
    expect(g.isCurrent(second)).toBe(true); // 2 is the live one
  });

  it('stays monotonic across many keystrokes', () => {
    const g = new SearchSeq();
    let last = 0;
    for (let i = 0; i < 5; i++) {
      const t = g.next();
      expect(t).toBeGreaterThan(last);
      last = t;
    }
    expect(g.isCurrent(last)).toBe(true);
  });
});

describe('sameStation — the identical-endpoints guard', () => {
  const pkg = pkgFromLines([{ lineId: 'z', groups: ['A', 'B'], kms: [1] }]);
  it('true when both endpoints are the same physical station', () => {
    const a = hitOn(pkg, 'z', 'A');
    expect(sameStation(a, a)).toBe(true);
  });
  it('false for two different stations', () => {
    expect(sameStation(hitOn(pkg, 'z', 'A'), hitOn(pkg, 'z', 'B'))).toBe(false);
  });
});

describe('classifyRoutes — no-route / single / multi decision (invariants #4, single-vs-multi)', () => {
  it('no-route when the two stations are on disconnected lines', () => {
    const pkg = pkgFromLines([
      { lineId: 'x', groups: ['X1', 'X2'], kms: [1] },
      { lineId: 'y', groups: ['Y1', 'Y2'], kms: [1] }, // shares no group with x
    ]);
    const out = classifyRoutes(pkg, hitOn(pkg, 'x', 'X1'), hitOn(pkg, 'y', 'Y2'));
    expect(out.kind).toBe('no-route');
  });

  it('single (auto-commit) when exactly one route exists on one line', () => {
    const pkg = pkgFromLines([{ lineId: 'z', groups: ['A', 'B', 'C'], kms: [1, 1] }]);
    const out = classifyRoutes(pkg, hitOn(pkg, 'z', 'A'), hitOn(pkg, 'z', 'C'));
    expect(out.kind).toBe('single');
    if (out.kind === 'single') expect(out.route.lines[0]).toBe('z');
  });

  it('multi (show picker) when two parallel lines both connect the endpoints', () => {
    const pkg = pkgFromLines([
      { lineId: 'p1', groups: ['A', 'M1', 'B'], kms: [2, 2] },
      { lineId: 'p2', groups: ['A', 'M2', 'B'], kms: [3, 3] },
    ]);
    const out = classifyRoutes(pkg, hitOn(pkg, 'p1', 'A'), hitOn(pkg, 'p1', 'B'));
    expect(out.kind).toBe('multi');
    if (out.kind === 'multi') expect(out.routes.length).toBeGreaterThanOrEqual(2);
  });

  it('prefers a route on the line the user actually picked (no phantom-parallel float)', () => {
    const pkg = pkgFromLines([
      { lineId: 'p1', groups: ['A', 'M1', 'B'], kms: [2, 2] }, // shorter — findRoutes would rank first by km
      { lineId: 'p2', groups: ['A', 'M2', 'B'], kms: [3, 3] },
    ]);
    // The user picked stations on p2 (the longer line); its route must come first despite the km rank.
    const out = classifyRoutes(pkg, hitOn(pkg, 'p2', 'A'), hitOn(pkg, 'p2', 'B'));
    expect(out.kind).toBe('multi');
    if (out.kind === 'multi') expect(out.routes[0].lines[0]).toBe('p2');
  });
});
