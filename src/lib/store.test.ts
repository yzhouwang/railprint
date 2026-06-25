import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  loadPackages,
  clearAllRides,
  markRide,
  markRoute,
  removeTrip,
  addEvents,
  removeImportBatch,
  replaceEvents,
  events,
  headline,
  litSegmentIds,
} from './store';
import { resolveCoverage } from './resolver';
import { JP_PACKAGE, STUB_PACKAGES, stationByName } from '../fixtures/stubPackage';
import type { RideEvent, RouteCandidate } from '../contract/types';

const route = (segmentIds: string[]): RouteCandidate => ({
  segmentIds,
  lines: [...new Set(segmentIds.map((s) => s.split(':')[0]))],
  totalKm: 10,
  lineChanges: 0,
  railGeoVersion: JP_PACKAGE.version,
});

const sid = (lineId: string, name: string): string => stationByName(JP_PACKAGE, lineId, name).stationId;

beforeEach(async () => {
  loadPackages(STUB_PACKAGES);
  await clearAllRides();
});

describe('markRide', () => {
  it('lights the slice and ticks the headline up', async () => {
    const before = get(headline).riddenKm;
    const res = await markRide({
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
      date: '2025-03-01',
    });
    expect(res.added).toBe(4);
    expect(res.alreadyCovered).toBe(0);
    expect(get(litSegmentIds)).toEqual(
      ['jr-kururi:0-1', 'jr-kururi:1-2', 'jr-kururi:2-3', 'jr-kururi:3-4'].sort(),
    );
    expect(get(headline).riddenKm).toBeGreaterThan(before);
  });

  it('assigns one shared tripId to every leg of a marking', async () => {
    await markRide({
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
    });
    const tripIds = new Set(get(events).map((e) => e.tripId));
    expect(tripIds.size).toBe(1);
    expect([...tripIds][0]).toBeTruthy();
  });

  it('re-riding the same slice appends a second trip while coverage stays stable', async () => {
    const opts = {
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
    };
    const first = await markRide(opts);
    const firstRows = get(events);
    const firstCoverage = resolveCoverage(firstRows, JP_PACKAGE);
    const second = await markRide(opts);
    const all = get(events);
    const secondCoverage = resolveCoverage(all, JP_PACKAGE);

    expect(first.added).toBe(4);
    expect(second.added).toBe(4);
    expect(second.alreadyCovered).toBe(4);
    expect(all).toHaveLength(8);
    expect(secondCoverage.litSegmentIds).toHaveLength(firstCoverage.litSegmentIds.length);
    expect(secondCoverage.riddenKm).toBe(firstCoverage.riddenKm);
    expect(new Set(all.map((e) => e.tripId)).size).toBe(2);
    expect(all.find((e) => e.id === firstRows[0].id)).toEqual(firstRows[0]);
  });

  it('a concurrent double-mark records two trips but still lights each segment once', async () => {
    const args = {
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
    };
    const [a, b] = await Promise.all([markRide(args), markRide(args)]);
    expect(a.added + b.added).toBe(8);
    expect(get(events)).toHaveLength(8);
    expect(get(litSegmentIds)).toHaveLength(4);
    expect(new Set(get(events).map((e) => e.tripId)).size).toBe(2);
  });

  it('persists the full slice on a partial-overlap re-mark', async () => {
    await markRide({
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
    });
    expect(get(events).length).toBe(4);
    const second = await markRide({
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '馬来田'), // overlaps the first 4 segs + 2 new
      pkg: JP_PACKAGE,
    });
    expect(second.added).toBe(6);
    expect(second.alreadyCovered).toBe(4);
    expect(get(events).length).toBe(10); // first 4 + full second slice of 6
    expect(get(litSegmentIds)).toHaveLength(6);
  });

  it('a same-trip double-submit overwrites deterministic event ids instead of duplicating', async () => {
    const uuid = '00000000-0000-4000-8000-000000000000' as ReturnType<typeof crypto.randomUUID>;
    const spy = vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
    try {
      const opts = {
        lineId: 'jr-kururi',
        fromStationId: sid('jr-kururi', '木更津'),
        toStationId: sid('jr-kururi', '横田'),
        pkg: JP_PACKAGE,
      };
      await markRide(opts);
      const second = await markRide(opts);
      expect(second.alreadyCovered).toBe(4);
      expect(get(events)).toHaveLength(4);
      expect(new Set(get(events).map((e) => e.tripId))).toEqual(new Set([uuid]));
    } finally {
      spy.mockRestore();
    }
  });

  it('canonicalizes trainModel on the stored event', async () => {
    await markRide({
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
      trainModel: 'n700-s',
    });
    expect(get(events)[0].trainModel).toBe('N700S');
  });

  it('throws when the two stations are not on the same line', async () => {
    await expect(
      markRide({
        lineId: 'jr-kururi',
        fromStationId: sid('jr-kururi', '木更津'),
        toStationId: sid('jr-yamanote', '東京'),
        pkg: JP_PACKAGE,
      }),
    ).rejects.toThrow();
  });
});

describe('event log operations', () => {
  function imported(segmentId: string, batch: string): RideEvent {
    return {
      id: `${batch}:${segmentId}`,
      segmentId,
      railGeoVersion: JP_PACKAGE.version,
      source: 'import',
      importBatchId: batch,
      createdAt: '2025-01-01T00:00:00.000Z',
    };
  }

  it('merges added events and can undo a whole import batch', async () => {
    const seg = JP_PACKAGE.segments[0].segmentId;
    await addEvents([imported(seg, 'batch-1')]);
    expect(get(litSegmentIds)).toContain(seg);
    await removeImportBatch('batch-1');
    expect(get(litSegmentIds)).not.toContain(seg);
  });

  it('replaceEvents wipes prior state (merge-vs-replace = replace)', async () => {
    await addEvents([imported(JP_PACKAGE.segments[0].segmentId, 'b1')]);
    await replaceEvents([imported(JP_PACKAGE.segments[5].segmentId, 'b2')]);
    expect(get(litSegmentIds)).toEqual([JP_PACKAGE.segments[5].segmentId]);
  });

  it('can remove a just-made trip', async () => {
    const res = await markRide({
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
    });
    expect(get(events)).toHaveLength(4);
    await removeTrip(res.tripId);
    expect(get(events)).toHaveLength(0);
  });
});

describe('markRoute (cross-line, one trip)', () => {
  const SEGS = ['jr-kururi:0-1', 'jr-kururi:1-2', 'jr-kururi:2-3'];

  it('marks every leg of a route under one tripId', async () => {
    const res = await markRoute(route(SEGS), { date: '2025-06-01' });
    expect(res.added).toBe(3);
    expect(res.alreadyCovered).toBe(0);
    const evs = get(events).filter((e) => SEGS.includes(e.segmentId));
    expect(evs).toHaveLength(3);
    expect(new Set(evs.map((e) => e.tripId)).size).toBe(1);
    expect(evs[0].tripId).toBe(res.tripId);
  });

  it('appends overlapping legs into a new trip without mutating the old trip', async () => {
    await markRoute(route(['jr-kururi:0-1']), { date: '2025-01-01' });
    const before = get(events).length;
    const firstLeg = get(events).find((e) => e.segmentId === 'jr-kururi:0-1')!;

    const res = await markRoute(route(['jr-kururi:0-1', 'jr-kururi:1-2']), { date: '2025-06-01' });
    expect(res.added).toBe(2);
    expect(res.alreadyCovered).toBe(1);
    expect(get(events).length).toBe(before + 2);

    expect(get(events).find((e) => e.id === firstLeg.id)).toEqual(firstLeg);
    const newLeg = get(events).find((e) => e.id === `${res.tripId}:jr-kururi:0-1`)!;
    expect(newLeg.tripId).toBe(res.tripId);
    expect(newLeg.date).toBe('2025-06-01');
  });

  it('creates a second trip after a full re-mark of the same route', async () => {
    const segs = ['jr-kururi:0-1', 'jr-kururi:1-2'];
    const first = await markRoute(route(segs));
    const second = await markRoute(route(segs));
    const ids = get(events).map((e) => e.segmentId).filter((s) => segs.includes(s));
    expect(ids.length).toBe(4);
    expect(new Set(get(events).map((e) => e.tripId))).toEqual(new Set([first.tripId, second.tripId]));
    expect(second.alreadyCovered).toBe(2);
  });

  it('returns alreadyCovered:N when every leg was already ridden', async () => {
    const segs = ['jr-kururi:0-1', 'jr-kururi:1-2'];
    await markRoute(route(segs));
    const res = await markRoute(route(segs)); // re-mark the whole route
    expect(res.added).toBe(2);
    expect(res.alreadyCovered).toBe(2);
  });

  it('canonicalizes trainModel on route events', async () => {
    await markRoute(route(['jr-kururi:0-1']), { trainModel: 'N700 S系' });
    expect(get(events)[0].trainModel).toBe('N700S');
  });
});
