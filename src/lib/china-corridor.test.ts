import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import type { RailGeoPackage } from '../contract/types';
import { JP_PACKAGE } from '../fixtures/stubPackage';
import { buildGeoIndex } from './store';
import { resolveCoverage } from './resolver';
import { buildWrappedData } from './wrapped/card';
import type { Headline } from './store';

// T3/T9 — the one China corridor proves the schema is country-agnostic. Golden-file the built
// package (read the committed artifact; regenerate with `npm run build:rail-geo:cn`).
const CN: RailGeoPackage = JSON.parse(readFileSync('public/rail/cn-jinghu-2025.json', 'utf8'));

describe('京沪 China corridor package (golden)', () => {
  it('is a well-formed CN package: WGS-84, 13 stations, 12 segments, plausible km', () => {
    expect(CN.country).toBe('CN');
    expect(CN.crs).toBe('WGS84'); // never GCJ-02
    expect(CN.stations).toHaveLength(13);
    expect(CN.segments).toHaveLength(12);
    const km = CN.segments.reduce((a, s) => a + s.km, 0);
    expect(km).toBeGreaterThan(1100); // curated polyline vs published ~1318km
    expect(km).toBeLessThan(1350);
    // no absurd inter-station jump (a bad coordinate would blow one segment up)
    expect(Math.max(...CN.segments.map((s) => s.km))).toBeLessThan(300);
  });

  it('carries the UX metadata the generic builder leaves off', () => {
    const line = CN.lines[0];
    expect(line.name).toBe('京沪高速铁路');
    expect(line.isHSR).toBe(true);
    expect(line.color).toBe('#C8102E');
    expect(line.operator).toBe('中国铁路');
    expect(line.nameRoma).toBe('Beijing–Shanghai HSR');
    expect(line.rank).toBe(0);
    expect(CN.stations.every((s) => !!s.nameRoma)).toBe(true); // pinyin on every stop
  });
});

describe('multi-country indexing + coverage isolation', () => {
  it('a geo index over JP + CN groups lines by country and unions segments', () => {
    const geo = buildGeoIndex([JP_PACKAGE, CN]);
    expect([...geo.linesByCountry.keys()].sort()).toEqual(['CN', 'JP']);
    expect(geo.lineById.get(CN.lines[0].lineId)?.country).toBe('CN');
    expect(geo.segmentById.has(CN.segments[0].segmentId)).toBe(true);
  });

  it('CN coverage is computed against the CN denominator alone — no JP pollution', () => {
    const oneCnLeg = [{ id: 'e1', segmentId: CN.segments[0].segmentId, railGeoVersion: CN.version, source: 'manual' as const, createdAt: '2025-01-01T00:00:00.000Z' }];
    const cnCov = resolveCoverage(oneCnLeg, CN);
    expect(cnCov.riddenKm).toBeCloseTo(CN.segments[0].km, 1);
    expect(cnCov.pctNational).toBeGreaterThan(0);
    // the same CN ride against the JP package resolves to nothing (disjoint ids)
    expect(resolveCoverage(oneCnLeg, JP_PACKAGE).riddenKm).toBe(0);
  });
});

describe('Wrapped uses the JAPAN %, never the JP+CN blend (T5)', () => {
  it('takes byCountry.JP.pctNational over the blended headline.pctNational', () => {
    const headline = {
      riddenKm: 100, totalKm: 1000, pctNational: 10, // blended (JP+CN) — misleading
      hsrRiddenKm: 50, hsrTotalKm: 500, pctHSR: 10, prefectures: 3, hasRides: true,
      byCountry: {
        JP: { pctNational: 38, pctHSR: 6, riddenKm: 90, totalKm: 240, hsrRiddenKm: 30, hsrTotalKm: 500, litSegmentIds: [], prefectures: 3 },
        CN: { pctNational: 1, pctHSR: 1, riddenKm: 10, totalKm: 1240, hsrRiddenKm: 10, hsrTotalKm: 1240, litSegmentIds: [], prefectures: 1 },
      },
    } as unknown as Headline;
    const data = buildWrappedData({ headline, coverages: [], geo: buildGeoIndex([]) });
    expect(data.stats[0].value).toBe('38'); // JP's 38%, not the blended 10%
  });
});
