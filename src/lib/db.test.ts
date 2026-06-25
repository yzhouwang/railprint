import { describe, it, expect, beforeEach } from 'vitest';
import { addRideSegments, markRouteSegments, getAllEvents, putEvents, clearAll, newId } from './db';
import type { RideEvent } from '../contract/types';

const fields = (tripId: string, date?: string) => ({
  railGeoVersion: '2025.1.0',
  source: 'manual' as const,
  tripId,
  createdAt: new Date().toISOString(),
  date,
});

// Direct coverage of the atomic dedup that closes the markRide concurrent-mark race.
// markRide pre-filters against the store snapshot, so these db-layer branches (empty input,
// partial overlap inside one transaction, all-already-present, concurrent serialization) are
// only reached nondeterministically through markRide — exercised deterministically here.

const ev = (segmentId: string): RideEvent => ({
  id: newId(),
  segmentId,
  railGeoVersion: '2025.1.0',
  source: 'manual',
  createdAt: new Date().toISOString(),
});

const segIds = async (): Promise<string[]> => (await getAllEvents()).map((e) => e.segmentId).sort();

beforeEach(async () => {
  await clearAll();
});

describe('addRideSegments (atomic dedup)', () => {
  it('returns [] and writes nothing for empty candidates', async () => {
    expect(await addRideSegments([])).toEqual([]);
    expect(await getAllEvents()).toHaveLength(0);
  });

  it('inserts all when none are already present', async () => {
    const out = await addRideSegments([ev('L:0-1'), ev('L:1-2')]);
    expect(out.map((e) => e.segmentId).sort()).toEqual(['L:0-1', 'L:1-2']);
    expect(await segIds()).toEqual(['L:0-1', 'L:1-2']);
  });

  it('inserts ONLY the fresh segments on a partial overlap (in-transaction dedup)', async () => {
    await putEvents([ev('L:0-1')]); // already in the log
    const out = await addRideSegments([ev('L:0-1'), ev('L:1-2'), ev('L:2-3')]);
    expect(out.map((e) => e.segmentId).sort()).toEqual(['L:1-2', 'L:2-3']);
    expect(await segIds()).toEqual(['L:0-1', 'L:1-2', 'L:2-3']); // no duplicate L:0-1
  });

  it('dedups repeats WITHIN one candidate set (a segmentId passed twice persists once)', async () => {
    const out = await addRideSegments([ev('L:0-1'), ev('L:0-1'), ev('L:1-2')]);
    expect(out.map((e) => e.segmentId).sort()).toEqual(['L:0-1', 'L:1-2']);
    expect(await segIds()).toEqual(['L:0-1', 'L:1-2']); // not L:0-1 twice
  });

  it('writes nothing when every candidate is already present', async () => {
    await putEvents([ev('L:0-1'), ev('L:1-2')]);
    expect(await addRideSegments([ev('L:0-1'), ev('L:1-2')])).toEqual([]);
    expect(await segIds()).toEqual(['L:0-1', 'L:1-2']); // still 2, no dup
  });

  it('serializes concurrent calls so a shared segment is written exactly once', async () => {
    const [a, b] = await Promise.all([
      addRideSegments([ev('L:0-1'), ev('L:1-2')]),
      addRideSegments([ev('L:0-1'), ev('L:1-2')]),
    ]);
    expect(a.length + b.length).toBe(2); // 2 total inserts, never 4
    expect(await segIds()).toEqual(['L:0-1', 'L:1-2']);
  });
});

describe('markRouteSegments (re-stamp upsert)', () => {
  it('returns {0,0} and writes nothing for empty input', async () => {
    expect(await markRouteSegments([], fields('t1'))).toEqual({ added: 0, restamped: 0 });
    expect(await getAllEvents()).toHaveLength(0);
  });

  it('inserts new legs and re-stamps existing ones in place (one row per segment)', async () => {
    await putEvents([ev('L:0-1')]); // a pre-existing leg under some other trip
    const before = (await getAllEvents()).find((e) => e.segmentId === 'L:0-1')!;
    const res = await markRouteSegments(['L:0-1', 'L:1-2'], fields('trip-X'));
    expect(res).toEqual({ added: 1, restamped: 1 });
    const all = await getAllEvents();
    expect(all).toHaveLength(2); // no duplicate of L:0-1
    const restamped = all.find((e) => e.segmentId === 'L:0-1')!;
    expect(restamped.id).toBe(before.id); // SAME row — update in place, not a new insert
    expect(restamped.tripId).toBe('trip-X'); // re-grouped into the new trip
  });

  it('dedups repeats within a single call', async () => {
    const res = await markRouteSegments(['L:0-1', 'L:0-1', 'L:1-2'], fields('t'));
    expect(res.added).toBe(2);
    expect(await segIds()).toEqual(['L:0-1', 'L:1-2']);
  });

  it('re-stamps ALL duplicate rows of a segment (none left stranded under the old trip)', async () => {
    // Two rows for the same segment (e.g. from two import batches) under different trips — segmentId
    // is a non-unique index, so this is reachable in the field.
    await putEvents([
      { ...ev('L:0-1'), tripId: 'old-a' },
      { ...ev('L:0-1'), tripId: 'old-b' },
    ]);
    const res = await markRouteSegments(['L:0-1'], fields('trip-NEW'));
    expect(res.restamped).toBe(2); // both rows re-stamped, not just one
    const rows = (await getAllEvents()).filter((e) => e.segmentId === 'L:0-1');
    expect(rows).toHaveLength(2); // still 2 rows — no spurious insert
    expect(rows.every((e) => e.tripId === 'trip-NEW')).toBe(true); // none left stranded
  });
});
