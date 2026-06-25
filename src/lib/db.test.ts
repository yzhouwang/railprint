import { describe, it, expect, beforeEach } from 'vitest';
import { addRideSegments, getAllEvents, putEvents, clearAll, newId } from './db';
import type { RideEvent } from '../contract/types';

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
