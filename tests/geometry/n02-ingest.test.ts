// Scenario + invariant tests for the N02 → RailGeoPackage adapter (pipeline/n02-ingest.ts).
// Synthetic N02 FeatureCollections exercise the algorithm's branches deterministically; the
// helpers below build minimal rail-section + station inputs. Real-data accuracy is gated
// separately by pipeline/verify-jp.ts (Shinkansen anchors).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPackageFromN02 } from '../../pipeline/n02-ingest.ts';
import { haversineKm } from '../../pipeline/geometry.ts';

type Pos = [number, number];
const section = (op: string, name: string, n02_002: string, coords: Pos[]): unknown => ({
  properties: { N02_004: op, N02_003: name, N02_002: n02_002 },
  geometry: { type: 'LineString', coordinates: coords },
});
const station = (op: string, name: string, g: string, stn: string, lon: number, lat: number): unknown => ({
  properties: { N02_004: op, N02_003: name, N02_005g: g, N02_005: stn, display_point: [lon, lat] },
  geometry: { type: 'LineString', coordinates: [[lon, lat]] },
});
const fc = (features: unknown[]): never => ({ features } as never);
const build = (secs: unknown[], stns: unknown[]) =>
  buildPackageFromN02(fc(secs), fc(stns), { country: 'JP', version: 't', generatedAt: 't' });
const lineKm = (pkg: { segments: { lineId: string; km: number }[] }, id: string): number =>
  pkg.segments.filter((s) => s.lineId === id).reduce((a, s) => a + s.km, 0);
// A line has no inherent direction — the 2-sweep diameter may orient either way, so accept
// the forward sequence OR its reverse.
const eqEitherDir = (actual: string[], forward: string[]): boolean =>
  JSON.stringify(actual) === JSON.stringify(forward) || JSON.stringify(actual) === JSON.stringify([...forward].reverse());

// A horizontal track at lat 35: 0.01° lon ≈ 0.91 km, 0.01° lat ≈ 1.11 km.
const LAT = 35;

test('open line: ordered stations, correct km, line-scoped colon-free ids', () => {
  const op = 'OP';
  const nm = 'OpenLine';
  const secs = [
    section(op, nm, '2', [[139.00, LAT], [139.05, LAT]]),
    section(op, nm, '2', [[139.05, LAT], [139.10, LAT]]),
  ];
  const stns = [
    station(op, nm, 'A', '駅A', 139.00, LAT),
    station(op, nm, 'B', '駅B', 139.05, LAT),
    station(op, nm, 'C', '駅C', 139.10, LAT),
  ];
  const { pkg } = build(secs, stns);
  assert.equal(pkg.lines.length, 1);
  const line = pkg.lines[0];
  assert.equal(line.isLoop, false);
  assert.equal(line.lineId.includes(':'), false, 'lineId must be colon-free');
  assert.ok(
    eqEitherDir(line.stationOrder, [`${line.lineId}:A`, `${line.lineId}:B`, `${line.lineId}:C`]),
    'stations ordered along the line (either direction)',
  );
  assert.equal(pkg.segments.length, 2);
  const expected = haversineKm([139.0, LAT], [139.1, LAT]);
  assert.ok(Math.abs(lineKm(pkg, line.lineId) - expected) < 0.05, 'km ≈ full straight length');
  // stationGroupId carries the raw N02_005g; stationId is line-scoped
  const a = pkg.stations.find((s) => s.name === '駅A')!;
  assert.equal(a.stationGroupId, 'A');
  assert.equal(a.stationId, `${line.lineId}:A`);
});

test('loop: detected, arcDirection set, wrap segment, km ≈ perimeter', () => {
  const op = 'OP';
  const nm = 'Ring';
  const ring: Pos[][] = [
    [[139.00, 35.00], [139.05, 35.00]],
    [[139.05, 35.00], [139.05, 35.05]],
    [[139.05, 35.05], [139.00, 35.05]],
    [[139.00, 35.05], [139.00, 35.00]],
  ];
  const secs = ring.map((c) => section(op, nm, '2', c));
  const stns = [
    station(op, nm, 'A', 'A', 139.00, 35.00),
    station(op, nm, 'B', 'B', 139.05, 35.00),
    station(op, nm, 'C', 'C', 139.05, 35.05),
    station(op, nm, 'D', 'D', 139.00, 35.05),
  ];
  const { pkg, stats } = build(secs, stns);
  const line = pkg.lines[0];
  assert.equal(line.isLoop, true, 'enclosed square is a real loop');
  assert.equal(stats.loops, 1);
  const segs = pkg.segments.filter((s) => s.lineId === line.lineId);
  assert.equal(segs.length, 4, 'loop has one segment per station incl. the wrap');
  assert.ok(segs.every((s) => s.arcDirection === 'cw' || s.arcDirection === 'ccw'));
  const perim = 2 * (haversineKm([139, 35], [139.05, 35]) + haversineKm([139.05, 35], [139.05, 35.05]));
  assert.ok(Math.abs(lineKm(pkg, line.lineId) - perim) < 0.2, 'km ≈ perimeter');
});

test('double-track out-and-back is NOT a loop and counts one track', () => {
  const op = 'OP';
  const nm = 'Double';
  const dy = 0.0003; // ~33m track spacing
  const secs = [
    section(op, nm, '2', [[139.00, 35.0], [139.05, 35.0]]),        // up track
    section(op, nm, '2', [[139.00, 35.0 + dy], [139.05, 35.0 + dy]]), // down track
    section(op, nm, '2', [[139.00, 35.0], [139.00, 35.0 + dy]]),    // west join
    section(op, nm, '2', [[139.05, 35.0], [139.05, 35.0 + dy]]),    // east join
  ];
  const stns = [
    station(op, nm, 'W', 'W', 139.00, 35.0 + dy / 2),
    station(op, nm, 'E', 'E', 139.05, 35.0 + dy / 2),
  ];
  const { pkg } = build(secs, stns);
  const line = pkg.lines[0];
  assert.equal(line.isLoop, false, 'thin out-and-back is not a geographic loop');
  const single = haversineKm([139, 35], [139.05, 35]);
  assert.ok(Math.abs(lineKm(pkg, line.lineId) - single) < 0.3, 'counts one track, not both');
});

test('disconnected components within cap are bridged; beyond cap are dropped', () => {
  const op = 'OP';
  const nm = 'Gappy';
  // piece 1: 139.00→139.04 ; piece 2 starts after a ~2km gap (≤ 3.5km cap)
  const near = build(
    [
      section(op, nm, '2', [[139.00, 35.0], [139.04, 35.0]]),
      section(op, nm, '2', [[139.062, 35.0], [139.10, 35.0]]),
    ],
    [
      station(op, nm, 'A', 'A', 139.00, 35.0),
      station(op, nm, 'B', 'B', 139.04, 35.0),
      station(op, nm, 'C', 'C', 139.062, 35.0),
      station(op, nm, 'D', 'D', 139.10, 35.0),
    ],
  );
  assert.equal(near.pkg.lines[0].stationOrder.length, 4, 'a sub-cap gap is bridged → all stations');
  assert.ok(near.stats.bridgedKm > 0, 'records synthetic bridge km');

  // same but a ~10km gap (> cap): the smaller piece is dropped
  const far = build(
    [
      section(op, nm, '2', [[139.00, 35.0], [139.04, 35.0]]),
      section(op, nm, '2', [[139.15, 35.0], [139.20, 35.0]]),
    ],
    [
      station(op, nm, 'A', 'A', 139.00, 35.0),
      station(op, nm, 'B', 'B', 139.04, 35.0),
      station(op, nm, 'C', 'C', 139.15, 35.0),
      station(op, nm, 'D', 'D', 139.20, 35.0),
    ],
  );
  assert.equal(far.pkg.lines[0].stationOrder.length, 2, 'an over-cap gap is NOT bridged → largest piece only');
  assert.equal(far.stats.bridgedKm, 0);
});

test('scrambled + duplicate station records are ordered and de-duped', () => {
  const op = 'OP';
  const nm = 'Scram';
  const secs = [
    section(op, nm, '2', [[139.00, 35.0], [139.05, 35.0]]),
    section(op, nm, '2', [[139.05, 35.0], [139.10, 35.0]]),
  ];
  const stns = [
    station(op, nm, 'B', '駅B', 139.05, 35.0), // out of order
    station(op, nm, 'A', '駅A', 139.00, 35.0),
    station(op, nm, 'C', '駅C', 139.10, 35.0),
    station(op, nm, 'C', '駅C', 139.10, 35.0), // exact dup id
    station(op, nm, 'A2', '駅A', 139.001, 35.0), // dup NAME, diff id
  ];
  const { pkg } = build(secs, stns);
  const line = pkg.lines[0];
  assert.equal(line.stationOrder.length, 3, 'dups collapsed to A,B,C');
  assert.ok(eqEitherDir(pkg.stations.map((s) => s.name), ['駅A', '駅B', '駅C']), 'ordered (either direction)');
});

test('same line name under different operators stays two distinct lines', () => {
  const nm = '山手線';
  const secs = [
    section('JR東日本', nm, '2', [[139.70, 35.68], [139.75, 35.69]]),       // Tokyo
    section('神戸市', nm, '3', [[135.18, 34.69], [135.20, 34.68]]),         // Kobe
  ];
  const stns = [
    station('JR東日本', nm, 'tk1', '東京A', 139.70, 35.68),
    station('JR東日本', nm, 'tk2', '東京B', 139.75, 35.69),
    station('神戸市', nm, 'kb1', '神戸A', 135.18, 34.69),
    station('神戸市', nm, 'kb2', '神戸B', 135.20, 34.68),
  ];
  const { pkg } = build(secs, stns);
  assert.equal(pkg.lines.length, 2, 'operator disambiguates same-name lines');
  assert.notEqual(pkg.lines[0].lineId, pkg.lines[1].lineId);
});

test('transfer station shared across lines: distinct stationId, shared stationGroupId', () => {
  const op = 'OP';
  const secs = [
    section(op, 'L1', '2', [[139.00, 35.0], [139.05, 35.0]]),
    section(op, 'L2', '2', [[139.05, 35.0], [139.05, 35.05]]),
  ];
  // 'HUB' (same N02_005g) is the shared transfer station on both lines.
  const stns = [
    station(op, 'L1', 'X1', 'X1', 139.00, 35.0),
    station(op, 'L1', 'HUB', '乗換', 139.05, 35.0),
    station(op, 'L2', 'HUB', '乗換', 139.05, 35.0),
    station(op, 'L2', 'Y1', 'Y1', 139.05, 35.05),
  ];
  const { pkg } = build(secs, stns);
  const hubs = pkg.stations.filter((s) => s.stationGroupId === 'HUB');
  assert.equal(hubs.length, 2, 'one RailStation per line for the transfer');
  assert.equal(new Set(hubs.map((s) => s.stationId)).size, 2, 'stationIds are line-unique (no collapse)');
});

test('HSR flag rides on N02_002 === "1"', () => {
  const hsr = build(
    [section('JR', 'Shink', '1', [[139.0, 35.0], [139.1, 35.0]])],
    [station('JR', 'Shink', 'A', 'A', 139.0, 35.0), station('JR', 'Shink', 'B', 'B', 139.1, 35.0)],
  );
  assert.equal(hsr.pkg.lines[0].isHSR, true);
  assert.equal(hsr.pkg.segments[0].isHSR, true);
  const local = build(
    [section('JR', 'Local', '2', [[139.0, 35.0], [139.1, 35.0]])],
    [station('JR', 'Local', 'A', 'A', 139.0, 35.0), station('JR', 'Local', 'B', 'B', 139.1, 35.0)],
  );
  assert.equal(local.pkg.lines[0].isHSR, false);
});

test('simplifyTolDeg drops vertices but preserves km (km computed pre-simplify)', () => {
  // A wiggly track: many vertices with a ~1m zigzag, well under the ~9m DP tolerance.
  const coords: Pos[] = [];
  for (let i = 0; i <= 40; i += 1) coords.push([139 + i * 0.001, 35 + (i % 2) * 1e-5]);
  const secs = [section('OP', 'Wig', '2', coords)];
  const stns = [station('OP', 'Wig', 'A', 'A', 139.0, 35.0), station('OP', 'Wig', 'B', 'B', 139.04, 35.0)];
  const plain = buildPackageFromN02(fc(secs), fc(stns), { country: 'JP', version: 't', generatedAt: 't' });
  const simp = buildPackageFromN02(fc(secs), fc(stns), { country: 'JP', version: 't', generatedAt: 't', simplifyTolDeg: 0.00008 });
  const verts = (p: typeof plain.pkg): number => p.segments.reduce((n, s) => n + s.geometry.coordinates.length, 0);
  assert.ok(verts(simp.pkg) < verts(plain.pkg), 'simplify removes near-collinear vertices');
  const km = (p: typeof plain.pkg): number => p.segments.reduce((a, s) => a + s.km, 0);
  assert.ok(Math.abs(km(plain.pkg) - km(simp.pkg)) < 0.01, 'km unchanged by simplification');
});

test('empty + degenerate inputs yield an empty package without throwing', () => {
  const empty = build([], []);
  assert.equal(empty.pkg.lines.length, 0);
  assert.equal(empty.pkg.segments.length, 0);
  assert.equal(empty.pkg.stations.length, 0);
  assert.equal(empty.stats.built, 0);
  // a line with a single station is skipped (needs >= 2)
  const oneStation = build(
    [section('OP', 'Solo', '2', [[139.0, 35.0], [139.05, 35.0]])],
    [station('OP', 'Solo', 'A', 'A', 139.0, 35.0)],
  );
  assert.equal(oneStation.pkg.lines.length, 0, '<2 stations → skipped');
  assert.ok(oneStation.stats.skipped >= 1);
});

test('package invariants hold across a multi-line build', () => {
  const secs = [
    section('OP', 'L1', '2', [[139.00, 35.0], [139.05, 35.0]]),
    section('OP', 'L1', '2', [[139.05, 35.0], [139.10, 35.0]]),
    section('OP', 'L2', '1', [[140.00, 36.0], [140.10, 36.0]]),
  ];
  const stns = [
    station('OP', 'L1', 'a', 'a', 139.00, 35.0),
    station('OP', 'L1', 'b', 'b', 139.05, 35.0),
    station('OP', 'L1', 'c', 'c', 139.10, 35.0),
    station('OP', 'L2', 'd', 'd', 140.00, 36.0),
    station('OP', 'L2', 'e', 'e', 140.10, 36.0),
  ];
  const { pkg } = build(secs, stns);
  assert.deepEqual(pkg.lines.map((line) => line.lineId), ['jp-OP-L1', 'jp-OP-L2'], 'clean lineIds without hash suffixes');
  assert.deepEqual(pkg.segments.map((segment) => segment.segmentId), [
    'jp-OP-L1:c-b',
    'jp-OP-L1:b-a',
    'jp-OP-L2:e-d',
  ], 'canonical segmentIds use ordered N02_005g group pairs');
  const groupByStationId = new Map(pkg.stations.map((s) => [s.stationId, s.stationGroupId]));
  const segIds = new Set<string>();
  for (const line of pkg.lines) {
    assert.equal(line.lineId.includes(':'), false, 'lineId colon-free');
    const lineStations = pkg.stations.filter((s) => s.lineId === line.lineId);
    assert.equal(line.stationOrder.length, lineStations.length, 'stationOrder matches station count');
    assert.equal(new Set(lineStations.map((s) => s.stationId)).size, lineStations.length, 'unique stationIds per line');
  }
  for (const seg of pkg.segments) {
    const fromGroup = groupByStationId.get(seg.fromStationId);
    const toGroup = groupByStationId.get(seg.toStationId);
    assert.equal(seg.segmentId, `${seg.lineId}:${fromGroup}-${toGroup}`, 'canonical group-pair segmentId');
    assert.equal(seg.segmentId.split(':')[0], seg.lineId, 'lineId recoverable from segmentId');
    assert.ok(seg.km > 0, 'positive km');
    assert.ok(!segIds.has(seg.segmentId), 'unique segmentId');
    segIds.add(seg.segmentId);
  }
});
