import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import {
  buildRailGeoPackage,
  isN02BusinessOperatorTypeHSR,
  lineLengthKm,
  stitchLineSections,
} from '../../pipeline/index.ts';
import type { LineBuildInput } from '../../pipeline/build-package.ts';

const execFileAsync = promisify(execFile);

test('stitches out-of-order sections into one direction-consistent line', () => {
  const stitched = stitchLineSections([
    { sectionId: 'b', coordinates: [[2, 0], [1, 0]] },
    { sectionId: 'a', coordinates: [[0, 0], [1, 0]] },
    { sectionId: 'c', coordinates: [[2, 0], [3, 0]] },
  ]);

  assert.equal(stitched.ok, true);
  assert.deepEqual(stitched.sectionOrder, ['a', 'b', 'c']);
  assert.deepEqual(stitched.line?.coordinates, [[0, 0], [1, 0], [2, 0], [3, 0]]);
});

test('builds projected HSR station sequence, segment ids, and feature properties', () => {
  const hsrLine: LineBuildInput = {
    lineId: 'jp:toy-shinkansen',
    name: '東海道新幹線 fixture',
    country: 'JP',
    n02_002: 1,
    sequenceStrategy: 'project',
    sections: [
      { sectionId: 's3', coordinates: [[3, 0], [2, 0]] },
      { sectionId: 's1', coordinates: [[0, 0], [1, 0]] },
      { sectionId: 's2', coordinates: [[1, 0], [2, 0]] },
      { sectionId: 's4', coordinates: [[3, 0], [4, 0]] },
    ],
    stations: [
      { stationId: 'shin-osaka', name: '新大阪', lon: 4, lat: 0 },
      { stationId: 'nagoya', name: '名古屋', lon: 2, lat: 0 },
      { stationId: 'tokyo', name: '東京', lon: 0, lat: 0 },
      { stationId: 'shizuoka', name: '静岡', lon: 1, lat: 0 },
    ],
  };

  const built = buildRailGeoPackage({
    version: '0.1.0-test',
    country: 'JP',
    generatedAt: '2026-06-23T00:00:00.000Z',
    lines: [hsrLine],
  });

  const pkg = built.railGeoPackage;
  assert.equal(pkg.crs, 'WGS84');
  assert.equal(pkg.lines[0].isHSR, true);
  assert.deepEqual(pkg.lines[0].stationOrder, ['tokyo', 'shizuoka', 'nagoya', 'shin-osaka']);
  assert.deepEqual(pkg.segments.map((segment) => segment.segmentId), [
    'jp:toy-shinkansen:1-2',
    'jp:toy-shinkansen:2-3',
    'jp:toy-shinkansen:3-4',
  ]);
  assert.equal(pkg.segments.every((segment) => segment.isHSR), true);
  assert.equal(built.validationReport.lines[0].status, 'ok');
  assert.equal(built.validationReport.attribution, '出典「国土数値情報（鉄道データ）」（国土交通省）を加工して作成');

  const feature = built.segmentFeatures.features[0];
  assert.equal(feature.properties.segmentId, 'jp:toy-shinkansen:1-2');
  assert.equal(feature.properties.isHSR, true);
});

test('reverses stitched geometry when station sequence runs opposite the raw section walk', () => {
  const line: LineBuildInput = {
    lineId: 'jp:reverse-fixture',
    name: 'reverse fixture',
    country: 'JP',
    isHSR: false,
    sections: [
      { sectionId: 'a', coordinates: [[0, 0], [1, 0]] },
      { sectionId: 'b', coordinates: [[1, 0], [2, 0]] },
      { sectionId: 'c', coordinates: [[2, 0], [3, 0]] },
    ],
    stations: [
      { stationId: 'west', name: 'West', lon: 3, lat: 0, seq: 1 },
      { stationId: 'mid', name: 'Mid', lon: 2, lat: 0, seq: 2 },
      { stationId: 'east', name: 'East', lon: 0, lat: 0, seq: 3 },
    ],
  };

  const built = buildRailGeoPackage({
    version: '0.1.0-test',
    country: 'JP',
    generatedAt: '2026-06-23T00:00:00.000Z',
    lines: [line],
  });

  assert.deepEqual(built.railGeoPackage.lines[0].geometry.coordinates, [[3, 0], [2, 0], [1, 0], [0, 0]]);
  assert.deepEqual(built.railGeoPackage.lines[0].stationOrder, ['west', 'mid', 'east']);
  assert.deepEqual(built.railGeoPackage.segments.map((segment) => segment.segmentId), [
    'jp:reverse-fixture:1-2',
    'jp:reverse-fixture:2-3',
  ]);
});

test('emits loop wrap segment with explicit arc direction', () => {
  const loopLine: LineBuildInput = {
    lineId: 'jp:yamanote-fixture',
    name: '山手線 fixture',
    country: 'JP',
    isLoop: true,
    isHSR: false,
    arcDirection: 'cw',
    sections: [
      { sectionId: 'bottom', coordinates: [[0, 0], [1, 0]] },
      { sectionId: 'right', coordinates: [[1, 0], [1, 1]] },
      { sectionId: 'top', coordinates: [[0, 1], [1, 1]] },
      { sectionId: 'left', coordinates: [[0, 1], [0, 0]] },
    ],
    stations: [
      { stationId: 'a', name: 'A', lon: 0, lat: 0, seq: 1 },
      { stationId: 'b', name: 'B', lon: 1, lat: 0, seq: 2 },
      { stationId: 'c', name: 'C', lon: 1, lat: 1, seq: 3 },
      { stationId: 'd', name: 'D', lon: 0, lat: 1, seq: 4 },
    ],
  };

  const built = buildRailGeoPackage({
    version: '0.1.0-test',
    country: 'JP',
    generatedAt: '2026-06-23T00:00:00.000Z',
    lines: [loopLine],
  });

  assert.equal(built.railGeoPackage.lines[0].isLoop, true);
  assert.deepEqual(built.railGeoPackage.segments.map((segment) => segment.segmentId), [
    'jp:yamanote-fixture:1-2',
    'jp:yamanote-fixture:2-3',
    'jp:yamanote-fixture:3-4',
    'jp:yamanote-fixture:4-1',
  ]);
  // arcDirection is DERIVED from the stitched winding (the unit-square fixture stitches CCW),
  // not copied from the input label.
  assert.equal(built.railGeoPackage.segments.every((segment) => segment.arcDirection === 'ccw'), true);
  assert.ok(lineLengthKm(built.railGeoPackage.segments[3].geometry) > 100);
});

test('fails closed and reports an override requirement for branching input', () => {
  const branchLine: LineBuildInput = {
    lineId: 'jp:branch-fixture',
    name: 'branch fixture',
    country: 'JP',
    isHSR: false,
    sections: [
      { sectionId: 'main-a', coordinates: [[0, 0], [1, 0]] },
      { sectionId: 'main-b', coordinates: [[1, 0], [2, 0]] },
      { sectionId: 'branch', coordinates: [[1, 0], [1, 1]] },
    ],
    stations: [],
  };

  const built = buildRailGeoPackage({
    version: '0.1.0-test',
    country: 'JP',
    generatedAt: '2026-06-23T00:00:00.000Z',
    lines: [branchLine],
  });

  assert.equal(built.railGeoPackage.lines.length, 0);
  assert.equal(built.validationReport.lines[0].status, 'requires-override');
  assert.equal(built.validationReport.lines[0].issues.some((issue) => issue.code === 'branching-line'), true);
});

test('keys HSR from N02_002 exactly as required by the plan', () => {
  assert.equal(isN02BusinessOperatorTypeHSR(1), true);
  assert.equal(isN02BusinessOperatorTypeHSR('1'), true);
  assert.equal(isN02BusinessOperatorTypeHSR(2), false);
  assert.equal(isN02BusinessOperatorTypeHSR(undefined), false);
});

test('CLI emits package, segment GeoJSON, validation report, and override report', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'railprint-geo-'));

  await execFileAsync(process.execPath, [
    'pipeline/cli.ts',
    '--input',
    'rail-geo/fixtures/jp-toy-input.json',
    '--out',
    outputDir,
  ]);

  const pkg = JSON.parse(await readFile(path.join(outputDir, 'jp-rail-geo-package.json'), 'utf8'));
  const segments = JSON.parse(await readFile(path.join(outputDir, 'jp-segments.geojson'), 'utf8'));
  const report = JSON.parse(await readFile(path.join(outputDir, 'jp-validation-report.json'), 'utf8'));
  const overrides = JSON.parse(await readFile(path.join(outputDir, 'jp-override-required.json'), 'utf8'));

  assert.equal(pkg.lines.length, 2);
  assert.equal(pkg.segments.some((segment: { segmentId: string }) => segment.segmentId === 'jp:yamanote-fixture:4-1'), true);
  assert.equal(segments.features.every((feature: { properties: { segmentId?: string; isHSR?: boolean } }) => (
    typeof feature.properties.segmentId === 'string' && typeof feature.properties.isHSR === 'boolean'
  )), true);
  assert.equal(report.lines.every((line: { status: string }) => line.status === 'ok'), true);
  assert.deepEqual(overrides.lines, []);
});

test('asserts real per-segment km against known great-circle distances', () => {
  const line: LineBuildInput = {
    lineId: 'jp:km-fixture',
    name: 'km fixture',
    country: 'JP',
    isHSR: false,
    sections: [
      { sectionId: 'a', coordinates: [[0, 0], [1, 0]] },
      { sectionId: 'b', coordinates: [[1, 0], [2, 0]] },
    ],
    stations: [
      { stationId: 's1', name: 'S1', lon: 0, lat: 0, seq: 1 },
      { stationId: 's2', name: 'S2', lon: 1, lat: 0, seq: 2 },
      { stationId: 's3', name: 'S3', lon: 2, lat: 0, seq: 3 },
    ],
  };
  const pkg = buildRailGeoPackage({
    version: '0.1.0-test', country: 'JP', generatedAt: '2026-06-23T00:00:00.000Z', lines: [line],
  }).railGeoPackage;
  // 1 degree of longitude at the equator ≈ 111.195 km (R=6371.0088).
  assert.ok(Math.abs(pkg.segments[0].km - 111.195) < 0.5, `seg0 km=${pkg.segments[0].km}`);
  assert.ok(Math.abs(pkg.segments[1].km - 111.195) < 0.5, `seg1 km=${pkg.segments[1].km}`);
});

test('loop with station order opposite the stitched winding still measures the SHORT arc', () => {
  const loop: LineBuildInput = {
    lineId: 'jp:loop-reverse-fixture',
    name: 'reverse loop fixture',
    country: 'JP',
    isLoop: true,
    isHSR: false,
    arcDirection: 'cw',
    sections: [
      { sectionId: 'bottom', coordinates: [[0, 0], [1, 0]] },
      { sectionId: 'right', coordinates: [[1, 0], [1, 1]] },
      { sectionId: 'top', coordinates: [[0, 1], [1, 1]] },
      { sectionId: 'left', coordinates: [[0, 1], [0, 0]] },
    ],
    stations: [
      { stationId: 'a', name: 'A', lon: 0, lat: 0, seq: 1 },
      { stationId: 'd', name: 'D', lon: 0, lat: 1, seq: 2 },
      { stationId: 'c', name: 'C', lon: 1, lat: 1, seq: 3 },
      { stationId: 'b', name: 'B', lon: 1, lat: 0, seq: 4 },
    ],
  };
  const built = buildRailGeoPackage({
    version: '0.1.0-test', country: 'JP', generatedAt: '2026-06-23T00:00:00.000Z', lines: [loop],
  });
  if (built.railGeoPackage.lines.length === 0) {
    assert.equal(built.validationReport.lines[0].status, 'requires-override');
    return;
  }
  for (const seg of built.railGeoPackage.segments) {
    assert.ok(seg.km < 160, `loop segment ${seg.segmentId} measured ${seg.km} km — expected the short arc (~111), got the long way around`);
  }
});

test('single-station line does not silently report ok with phantom coverage', () => {
  const line: LineBuildInput = {
    lineId: 'jp:single-station',
    name: 'single station',
    country: 'JP',
    isHSR: false,
    sections: [{ sectionId: 'a', coordinates: [[0, 0], [1, 0]] }],
    stations: [{ stationId: 'only', name: 'Only', lon: 0, lat: 0, seq: 1 }],
  };
  const built = buildRailGeoPackage({
    version: '0.1.0-test', country: 'JP', generatedAt: '2026-06-23T00:00:00.000Z', lines: [line],
  });
  const shipped = built.railGeoPackage.lines.length === 1;
  const flagged = built.validationReport.lines[0]?.status === 'requires-override';
  assert.ok(flagged || (shipped && built.railGeoPackage.segments.length === 0));
});

test('fails closed when a station projects too far from its own line', () => {
  const line: LineBuildInput = {
    lineId: 'jp:off-line-fixture',
    name: 'off line fixture',
    country: 'JP',
    isHSR: false,
    sections: [{ sectionId: 'a', coordinates: [[0, 0], [1, 0]] }],
    stations: [
      { stationId: 's1', name: 'S1', lon: 0, lat: 0, seq: 1 },
      { stationId: 'wrong', name: 'Wrong line', lon: 1, lat: 5, seq: 2 }, // ~555 km off
    ],
  };
  const built = buildRailGeoPackage({
    version: '0.1.0-test', country: 'JP', generatedAt: '2026-06-23T00:00:00.000Z', lines: [line],
  });
  assert.equal(built.railGeoPackage.lines.length, 0);
  assert.equal(built.validationReport.lines[0].status, 'requires-override');
  assert.equal(built.validationReport.lines[0].issues.some((i) => i.code === 'station-off-line'), true);
});

test('fails closed on duplicate station seq (segment id collision)', () => {
  const line: LineBuildInput = {
    lineId: 'jp:dup-seq-fixture',
    name: 'dup seq fixture',
    country: 'JP',
    isHSR: false,
    sections: [{ sectionId: 'a', coordinates: [[0, 0], [2, 0]] }],
    stations: [
      { stationId: 's1', name: 'S1', lon: 0, lat: 0, seq: 1 },
      { stationId: 's2', name: 'S2', lon: 1, lat: 0, seq: 1 }, // duplicate seq
      { stationId: 's3', name: 'S3', lon: 2, lat: 0, seq: 2 },
    ],
  };
  const built = buildRailGeoPackage({
    version: '0.1.0-test', country: 'JP', generatedAt: '2026-06-23T00:00:00.000Z', lines: [line],
  });
  assert.equal(built.railGeoPackage.lines.length, 0);
  assert.equal(built.validationReport.lines[0].issues.some((i) => i.code === 'duplicate-station'), true);
});

test('stitches sections whose shared endpoint is a near-miss (a few metres apart)', () => {
  // Two sections meeting at ~(1,0) but the second starts 5e-5° east (~5.5 m) — a raw N02 near-miss.
  const stitched = stitchLineSections([
    { sectionId: 'a', coordinates: [[0, 0], [1, 0]] },
    { sectionId: 'b', coordinates: [[1.00005, 0], [2, 0]] },
  ]);
  assert.equal(stitched.ok, true);
  assert.deepEqual(stitched.sectionOrder, ['a', 'b']);
});
