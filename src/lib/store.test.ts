import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  loadPackages,
  clearAllRides,
  markRide,
  markRoute,
  addEvents,
  removeImportBatch,
  replaceEvents,
  events,
  headline,
  litSegmentIds,
} from './store';
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

  it('guards a fully-redundant re-mark (この区間は記録済み)', async () => {
    const opts = {
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
    };
    await markRide(opts);
    const countAfterFirst = get(events).length;
    const second = await markRide(opts);
    expect(second.added).toBe(0);
    expect(get(events).length).toBe(countAfterFirst); // nothing new persisted
  });

  it('a concurrent double-mark of the same slice persists each segment once', async () => {
    const args = {
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
    };
    const [a, b] = await Promise.all([markRide(args), markRide(args)]);
    // The slice is 4 segments; across both calls exactly 4 are newly added, not 8.
    expect(a.added + b.added).toBe(4);
    // The durable log holds each segment exactly once.
    const ids = get(events).map((e) => e.segmentId);
    expect(ids.length).toBe(new Set(ids).size);
    expect(ids.length).toBe(4);
  });

  it('persists only the NEW segments on a partial-overlap re-mark (no duplicate events)', async () => {
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
    expect(second.added).toBe(2);
    expect(get(events).length).toBe(6); // 4 + 2, NOT 4 + 6 — no re-stamped duplicates
    const ids = get(events).map((e) => e.segmentId);
    expect(new Set(ids).size).toBe(ids.length); // each ridden segment logged exactly once
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
});

describe('markRoute (cross-line, one trip)', () => {
  const SEGS = ['jr-kururi:0-1', 'jr-kururi:1-2', 'jr-kururi:2-3'];

  it('marks every leg of a route under one tripId', async () => {
    const res = await markRoute(route(SEGS), { date: '2025-06-01' });
    expect(res.added).toBe(3);
    expect(res.restamped).toBe(0);
    const evs = get(events).filter((e) => SEGS.includes(e.segmentId));
    expect(evs).toHaveLength(3);
    expect(new Set(evs.map((e) => e.tripId)).size).toBe(1);
    expect(evs[0].tripId).toBe(res.tripId);
  });

  it('re-stamps an overlapping leg into the new trip WITHOUT duplicating it', async () => {
    await markRoute(route(['jr-kururi:0-1']), { date: '2025-01-01' });
    const before = get(events).length;
    const firstTrip = get(events).find((e) => e.segmentId === 'jr-kururi:0-1')!.tripId;

    const res = await markRoute(route(['jr-kururi:0-1', 'jr-kururi:1-2']), { date: '2025-06-01' });
    expect(res.added).toBe(1); // only :1-2 is new
    expect(res.restamped).toBe(1); // :0-1 was re-stamped, not re-inserted
    expect(get(events).length).toBe(before + 1); // NO bloat — one new event, never a duplicate

    const leg = get(events).find((e) => e.segmentId === 'jr-kururi:0-1')!;
    expect(leg.tripId).toBe(res.tripId); // re-grouped into the new trip
    expect(leg.tripId).not.toBe(firstTrip);
    expect(leg.date).toBe('2025-01-01'); // original ride date preserved, not clobbered
  });

  it('keeps one event per segment after a full re-mark of the same route', async () => {
    const segs = ['jr-kururi:0-1', 'jr-kururi:1-2'];
    await markRoute(route(segs));
    await markRoute(route(segs));
    const ids = get(events).map((e) => e.segmentId).filter((s) => segs.includes(s));
    expect(ids.length).toBe(2);
    expect(ids.length).toBe(new Set(ids).size);
  });
});
