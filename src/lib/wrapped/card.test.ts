import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';
import { buildWrappedData } from './card';
import { resolveCoverage } from '../resolver';
import { headline as headlineStore, coverages as coveragesStore, geo as geoStore, loadPackages, replaceEvents, clearAllRides } from '../store';
import { JP_PACKAGE, STUB_PACKAGES } from '../fallback-package';
import type { RideEvent } from '../../contract/types';

// Build the inputs the screen passes by snapshotting the live store after seeding events.
async function inputsFor(events: RideEvent[]) {
  loadPackages(STUB_PACKAGES);
  await replaceEvents(events);
  return {
    headline: get(headlineStore),
    coverages: get(coveragesStore),
    geo: get(geoStore),
  };
}

function event(segmentId: string, extra: Partial<RideEvent> = {}): RideEvent {
  return {
    id: `e:${segmentId}:${extra.tripId ?? ''}`,
    segmentId,
    railGeoVersion: JP_PACKAGE.version,
    source: 'manual',
    createdAt: '2025-03-01T00:00:00.000Z',
    ...extra,
  };
}

describe('buildWrappedData (pure superlative shaping)', () => {
  it('resolves longest ride to station NAMES with km, and the most-ridden line name', async () => {
    // A 東海道新幹線 trip 東京→新大阪 (the whole HSR line) — the longest ride by far,
    // sharing one tripId so the kernel groups it. Plus a Yamanote model so we have a model.
    const tokaido = JP_PACKAGE.segments
      .filter((s) => s.lineId === 'jr-tokaido-shinkansen')
      .map((s) => event(s.segmentId, { tripId: 'trip-hsr', trainModel: 'N700S' }));
    const inputs = await inputsFor(tokaido);

    const data = buildWrappedData({ ...inputs, now: new Date('2026-06-23T00:00:00Z') });

    const longest = data.superlatives.find((s) => s.label === '最長乗車');
    expect(longest).toBeDefined();
    // endpoints resolved to NAMES (sorted by pathEndpoints), not raw ids
    expect(longest!.value).toContain('東京');
    expect(longest!.value).toContain('新大阪');
    expect(longest!.value).toContain('→');
    expect(longest!.value).not.toContain('jr-tokaido'); // never leak an id
    expect(longest!.sub).toMatch(/km$/);

    const line = data.superlatives.find((s) => s.label === '最も乗った路線');
    expect(line?.value).toBe('東海道新幹線'); // lineId → name

    const model = data.superlatives.find((s) => s.label === '最速の車両');
    expect(model?.value).toBe('N700S');

    // hero stats are present and zero-safe formatted
    expect(data.stats).toHaveLength(3);
    expect(data.stats[0].unit).toBe('%');
    expect(data.totalKm).toBeGreaterThan(0);
    // resolver agrees the HSR % denominator was exercised
    const cov = resolveCoverage(tokaido, JP_PACKAGE);
    expect(cov.pctHSR).toBeGreaterThan(0);
  });

  it('handles the zero/empty state without NaN and with no superlatives', async () => {
    const inputs = await inputsFor([]);
    const data = buildWrappedData(inputs);

    expect(data.totalKm).toBe(0);
    expect(data.superlatives).toEqual([]);
    for (const stat of data.stats) {
      expect(stat.value).not.toContain('NaN');
      expect(Number.isNaN(Number(stat.value.replace(/,/g, '')))).toBe(false);
    }
    expect(data.stats[0].value).toBe('0'); // 0% national, not NaN%
  });

  it('falls back to the raw id only when geo has no name (defensive)', async () => {
    const inputs = await inputsFor([]);
    // Hand it a fabricated coverage whose ids are not in the geo index.
    const data = buildWrappedData({
      ...inputs,
      coverages: [
        {
          result: {
            riddenKm: 10,
            totalKm: 100,
            pctNational: 10,
            hsrRiddenKm: 0,
            hsrTotalKm: 0,
            pctHSR: 0,
            litSegmentIds: [],
            prefectures: 1,
            longestRide: { fromStationId: 'ghost.0', toStationId: 'ghost.1', km: 10 },
            mostRiddenLineId: 'ghost-line',
          },
        },
      ],
    });
    const longest = data.superlatives.find((s) => s.label === '最長乗車');
    expect(longest!.value).toBe('ghost.0 → ghost.1');
    const line = data.superlatives.find((s) => s.label === '最も乗った路線');
    expect(line!.value).toBe('ghost-line');
  });

  it('picks the cross-package longest ride by km', async () => {
    // Short Kururi ride + the long Tokaido ride; longest must be the Tokaido one.
    const kururi = event('jr-kururi:0-1', { tripId: 'k' });
    const tokaido = JP_PACKAGE.segments
      .filter((s) => s.lineId === 'jr-tokaido-shinkansen')
      .map((s) => event(s.segmentId, { tripId: 'trip-hsr' }));
    const inputs = await inputsFor([kururi, ...tokaido]);
    const data = buildWrappedData(inputs);
    const longest = data.superlatives.find((s) => s.label === '最長乗車');
    // Tokaido endpoints, not the 1-segment Kururi leg.
    expect(longest!.value).toContain('新大阪');
  });

  it('uses sensible endpoints for a marked Yamanote slice (sanity on names)', async () => {
    const inputs = await inputsFor([
      event('jr-yamanote:0-1', { tripId: 't' }),
      event('jr-yamanote:1-2', { tripId: 't' }),
    ]);
    const data = buildWrappedData(inputs);
    const longest = data.superlatives.find((s) => s.label === '最長乗車');
    expect(longest).toBeDefined();
    // 東京(0) 神田(1) 秋葉原(2) — endpoints are 東京 & 秋葉原
    expect(longest!.value).toContain('東京');
    expect(longest!.value).toContain('秋葉原');
  });
});

// Keep the shared fake-indexeddb clean for any other suite.
import { afterAll } from 'vitest';
afterAll(async () => {
  await clearAllRides();
});
