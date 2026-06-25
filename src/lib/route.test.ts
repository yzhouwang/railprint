import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import type { RailGeoPackage, RailLine, RailSegment, RailStation } from '../contract/types';
import { JP_PACKAGE, STUB_PACKAGES, stationByName } from '../fixtures/stubPackage';
import { segmentsBetween } from './resolver';
import { __routeTest, findRoutes } from './route';

const soloKey = (stationId: string): string => `solo:${stationId}`;
const groupKey = (station: RailStation): string => station.stationGroupId ?? soloKey(station.stationId);

beforeEach(() => {
  __routeTest.resetGraphCache();
});

describe('route graph', () => {
  it('builds segment edges, pairwise switch edges, and no switch edge for solo stations', () => {
    expect(STUB_PACKAGES).toContain(JP_PACKAGE);
    const graph = __routeTest.graphForPackage(JP_PACKAGE);

    const kisarazu = stationByName(JP_PACKAGE, 'jr-kururi', '木更津');
    const gion = stationByName(JP_PACKAGE, 'jr-kururi', '祇園');
    expect(graph.edges.get(kisarazu.stationId)?.some((e) =>
      e.kind === 'segment' && e.to === gion.stationId && e.segmentId === 'jr-kururi:0-1' && e.lineId === 'jr-kururi',
    )).toBe(true);
    expect(graph.edges.get(gion.stationId)?.some((e) =>
      e.kind === 'segment' && e.to === kisarazu.stationId && e.segmentId === 'jr-kururi:0-1',
    )).toBe(true);

    const yamanoteShibuya = stationByName(JP_PACKAGE, 'jr-yamanote', '渋谷');
    const toyokoShibuya = stationByName(JP_PACKAGE, 'tokyu-toyoko', '渋谷');
    expect(graph.edges.get(yamanoteShibuya.stationId)?.some((e) =>
      e.kind === 'switch' && e.to === toyokoShibuya.stationId && e.lineChanges === 1 && e.km === 0 && !e.segmentId,
    )).toBe(true);
    expect(graph.edges.get(toyokoShibuya.stationId)?.some((e) =>
      e.kind === 'switch' && e.to === yamanoteShibuya.stationId && e.lineChanges === 1 && e.km === 0 && !e.segmentId,
    )).toBe(true);

    const kanda = stationByName(JP_PACKAGE, 'jr-yamanote', '神田');
    expect(graph.stationsByGroup.get(soloKey(kanda.stationId))).toEqual([kanda.stationId]);
    expect(graph.edges.get(kanda.stationId)?.some((e) => e.kind === 'switch')).toBe(false);
  });

  it('memoizes the graph by package identity', () => {
    const from = stationByName(JP_PACKAGE, 'jr-kururi', '木更津');
    const to = stationByName(JP_PACKAGE, 'jr-kururi', '横田');

    const first = findRoutes(JP_PACKAGE, groupKey(from), groupKey(to), 3);
    const second = findRoutes(JP_PACKAGE, groupKey(from), groupKey(to), 3);

    expect(__routeTest.graphBuildCount()).toBe(1);
    expect(second).toEqual(first);
  });
});

describe('findRoutes', () => {
  it('preserves single-line segmentsBetween parity', () => {
    const lineId = 'jr-kururi';
    const from = stationByName(JP_PACKAGE, lineId, '木更津');
    const to = stationByName(JP_PACKAGE, lineId, '横田');
    const expected = segmentsBetween(lineId, from.stationId, to.stationId, JP_PACKAGE);

    const routes = findRoutes(JP_PACKAGE, groupKey(from), groupKey(to), 3);
    expect(routes.some((route) =>
      route.lineChanges === 0 && route.lines[0] === lineId && sameArray(route.segmentIds, expected),
    )).toBe(true);
  });

  it('finds the real 津 to 大阪難波 three-line Kintetsu route', () => {
    const realPkg = JSON.parse(readFileSync('public/rail/jp-2025.json', 'utf8')) as RailGeoPackage;
    const expectedLines = ['名古屋線', '大阪線', '難波線'].map((name) => {
      const line = realPkg.lines.find((candidate) =>
        candidate.operator === '近畿日本鉄道' && candidate.name === name,
      );
      if (!line) throw new Error(`missing Kintetsu line ${name}`);
      return line.lineId;
    });

    const routes = findRoutes(realPkg, '006905', '007308', 3);
    const route = routes.find((candidate) => sameArray(candidate.lines, expectedLines));

    expect(route).toBeDefined();
    expect(route?.lineChanges).toBe(2);
    expect(route?.segmentIds.length).toBeGreaterThan(0);
    expect(route ? isContiguous(realPkg, '006905', '007308', route.segmentIds) : false).toBe(true);
  });

  it('keeps every shared single-line route even when k is smaller', () => {
    const pkg = packageFromLines([
      { lineId: 'parallel-a', groups: ['A', 'A1', 'B'], kms: [2, 2] },
      { lineId: 'parallel-b', groups: ['A', 'B1', 'B'], kms: [3, 3] },
    ]);

    const routes = findRoutes(pkg, 'A', 'B', 1);
    const zeroChange = routes.filter((route) => route.lineChanges === 0);

    expect(zeroChange).toHaveLength(2);
    expect(zeroChange.map((route) => route.lines[0]).sort()).toEqual(['parallel-a', 'parallel-b']);
  });

  it('surfaces both loop arcs and ranks the shorter first', () => {
    const shinjuku = stationByName(JP_PACKAGE, 'jr-yamanote', '新宿');
    const tokyo = stationByName(JP_PACKAGE, 'jr-yamanote', '東京');

    const routes = findRoutes(JP_PACKAGE, groupKey(shinjuku), groupKey(tokyo), 2);
    const yamanote = routes.filter((route) => route.lineChanges === 0 && route.lines[0] === 'jr-yamanote');

    expect(yamanote).toHaveLength(2);
    expect(yamanote[0].totalKm).toBeLessThanOrEqual(yamanote[1].totalKm);
    expect(canonicalSegmentKey(yamanote[0].segmentIds)).not.toBe(canonicalSegmentKey(yamanote[1].segmentIds));
  });

  it('ranks fewer line changes before a shorter higher-change route', () => {
    const pkg = packageFromLines([
      { lineId: 'long-direct', groups: ['A', 'X', 'B'], kms: [100, 100] },
      { lineId: 'short-left', groups: ['A', 'C'], kms: [1] },
      { lineId: 'short-right', groups: ['C', 'B'], kms: [1] },
    ]);

    const routes = findRoutes(pkg, 'A', 'B', 2);

    expect(routes[0]).toMatchObject({ lineChanges: 0, lines: ['long-direct'], totalKm: 200 });
    expect(routes[1]).toMatchObject({ lineChanges: 1, lines: ['short-left', 'short-right'], totalKm: 2 });
  });

  it('returns deterministic ordering for identical inputs', () => {
    const from = stationByName(JP_PACKAGE, 'jr-yamanote', '新宿');
    const to = stationByName(JP_PACKAGE, 'jr-yamanote', '東京');

    expect(findRoutes(JP_PACKAGE, groupKey(from), groupKey(to), 3)).toEqual(
      findRoutes(JP_PACKAGE, groupKey(from), groupKey(to), 3),
    );
  });

  it('returns [] for same, unknown, and disconnected group pairs', () => {
    const shinjuku = stationByName(JP_PACKAGE, 'jr-yamanote', '新宿');
    expect(findRoutes(JP_PACKAGE, groupKey(shinjuku), groupKey(shinjuku), 3)).toEqual([]);
    expect(findRoutes(JP_PACKAGE, 'missing-a', groupKey(shinjuku), 3)).toEqual([]);

    const disconnected = packageFromLines([
      { lineId: 'island-a', groups: ['A', 'A1'], kms: [1] },
      { lineId: 'island-b', groups: ['B', 'B1'], kms: [1] },
    ]);
    expect(findRoutes(disconnected, 'A', 'B', 3)).toEqual([]);
  });
});

function sameArray<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function canonicalSegmentKey(segmentIds: string[]): string {
  return [...segmentIds].sort().join('\0');
}

function isContiguous(pkg: RailGeoPackage, fromGroupKey: string, toGroupKey: string, segmentIds: string[]): boolean {
  const segments = new Map(pkg.segments.map((segment) => [segment.segmentId, segment]));
  const stations = new Map(pkg.stations.map((station) => [station.stationId, station]));
  let possible = new Set([fromGroupKey]);

  for (const segmentId of segmentIds) {
    const segment = segments.get(segmentId);
    if (!segment) return false;
    const a = groupKey(stations.get(segment.fromStationId)!);
    const b = groupKey(stations.get(segment.toStationId)!);
    const next = new Set<string>();
    if (possible.has(a)) next.add(b);
    if (possible.has(b)) next.add(a);
    if (next.size === 0) return false;
    possible = next;
  }

  return possible.has(toGroupKey);
}

interface LineDef {
  lineId: string;
  groups: string[];
  kms: number[];
}

function packageFromLines(lineDefs: LineDef[]): RailGeoPackage {
  const lines: RailLine[] = [];
  const stations: RailStation[] = [];
  const segments: RailSegment[] = [];

  for (const def of lineDefs) {
    const lineStations = def.groups.map((group, seq): RailStation => ({
      stationId: `${def.lineId}.${seq}`,
      name: group,
      lineId: def.lineId,
      seq,
      lon: seq,
      lat: lineDefs.indexOf(def),
      stationGroupId: group,
    }));
    stations.push(...lineStations);
    lines.push({
      lineId: def.lineId,
      name: def.lineId,
      country: 'JP',
      isHSR: false,
      isLoop: false,
      stationOrder: lineStations.map((station) => station.stationId),
      geometry: { type: 'LineString', coordinates: lineStations.map((station) => [station.lon, station.lat]) },
    });
    for (let i = 0; i < lineStations.length - 1; i += 1) {
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

  return {
    version: 'test-route.1',
    generatedAt: '2026-06-25T00:00:00.000Z',
    crs: 'WGS84',
    country: 'JP',
    lines,
    segments,
    stations,
  };
}
