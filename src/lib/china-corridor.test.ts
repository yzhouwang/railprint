import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';
import type { RailGeoPackage } from '../contract/types';
import { JP_PACKAGE } from '../fixtures/stubPackage';
import { buildGeoIndex, loadPackages, events as eventsStore, usingFallback, dataDegraded } from './store';
import { resolveCoverage } from './resolver';
import { buildWrappedData } from './wrapped/card';
import type { Headline } from './store';

// T3/T9 — the one China corridor proves the schema is country-agnostic. Golden-file the built
// package (read the committed artifact; it is produced by the railnet package and synced in via
// `npm run sync:railnet`).
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

  it('dataDegraded fires when a saved ride is in NO loaded package (CN corridor failed to load)', () => {
    loadPackages([JP_PACKAGE]); // JP loaded, CN corridor "missing"
    usingFallback.set(false);
    eventsStore.set([
      { id: 'e1', segmentId: CN.segments[0].segmentId, railGeoVersion: CN.version, source: 'manual', createdAt: 't' },
    ]);
    expect(get(dataDegraded)).toBe(true); // the China ride would silently read 0 — surface it
    eventsStore.set([]);
    expect(get(dataDegraded)).toBe(false);
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

  it('a China-only rider gets the CN %, not a misleading JP 0%', () => {
    const headline = {
      riddenKm: 100, totalKm: 1240, pctNational: 8, hsrRiddenKm: 100, hsrTotalKm: 1240, pctHSR: 8,
      prefectures: 2, hasRides: true,
      byCountry: {
        JP: { pctNational: 0, pctHSR: 0, riddenKm: 0, totalKm: 9000, hsrRiddenKm: 0, hsrTotalKm: 3000, litSegmentIds: [], prefectures: 0 },
        CN: { pctNational: 8, pctHSR: 8, riddenKm: 100, totalKm: 1240, hsrRiddenKm: 100, hsrTotalKm: 1240, litSegmentIds: [], prefectures: 2 },
      },
    } as unknown as Headline;
    const data = buildWrappedData({ headline, coverages: [], geo: buildGeoIndex([]) });
    expect(data.stats[0].value).toBe('8'); // the CN rider's 8%, not JP's 0%
  });
});
