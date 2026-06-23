import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  loadPackages,
  clearAllRides,
  markRide,
  addEvents,
  removeImportBatch,
  replaceEvents,
  events,
  headline,
  litSegmentIds,
} from './store';
import { JP_PACKAGE, STUB_PACKAGES, stationByName } from '../fixtures/stubPackage';
import type { RideEvent } from '../contract/types';

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
