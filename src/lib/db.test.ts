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

const ev = (segmentId: string, id = newId(), tripId?: string): RideEvent => ({
  id,
  segmentId,
  railGeoVersion: '2025.1.0',
  source: 'manual',
  tripId,
  createdAt: new Date().toISOString(),
});

const segIds = async (): Promise<string[]> => (await getAllEvents()).map((e) => e.segmentId).sort();
const eventIds = async (): Promise<string[]> => (await getAllEvents()).map((e) => e.id).sort();

beforeEach(async () => {
  await clearAll();
});

describe('addRideSegments (append by event id)', () => {
  it('returns [] and writes nothing for empty candidates', async () => {
    expect(await addRideSegments([])).toEqual([]);
    expect(await getAllEvents()).toHaveLength(0);
  });

  it('inserts all when none are already present', async () => {
    const out = await addRideSegments([ev('L:0-1'), ev('L:1-2')]);
    expect(out.map((e) => e.segmentId).sort()).toEqual(['L:0-1', 'L:1-2']);
    expect(await segIds()).toEqual(['L:0-1', 'L:1-2']);
  });

  it('appends a repeat ride of an already-logged segment when the event id is new', async () => {
    await putEvents([ev('L:0-1', 'trip-a:L:0-1', 'trip-a')]);
    const out = await addRideSegments([ev('L:0-1', 'trip-b:L:0-1', 'trip-b')]);
    expect(out.map((e) => e.id)).toEqual(['trip-b:L:0-1']);
    expect(await segIds()).toEqual(['L:0-1', 'L:0-1']);
  });

  it('dedups repeats WITHIN one candidate set by id', async () => {
    const a = ev('L:0-1', 'trip:L:0-1', 'trip');
    const out = await addRideSegments([a, { ...a }, ev('L:1-2', 'trip:L:1-2', 'trip')]);
    expect(out.map((e) => e.segmentId).sort()).toEqual(['L:0-1', 'L:1-2']);
    expect(await eventIds()).toEqual(['trip:L:0-1', 'trip:L:1-2']);
  });

  it('bulkPut-overwrites a re-submit with the same ids instead of duplicating rows', async () => {
    const rows = [ev('L:0-1', 'trip:L:0-1', 'trip'), ev('L:1-2', 'trip:L:1-2', 'trip')];
    expect(await addRideSegments(rows)).toHaveLength(2);
    expect(await addRideSegments(rows)).toHaveLength(2);
    expect(await eventIds()).toEqual(['trip:L:0-1', 'trip:L:1-2']);
  });

  it('concurrent re-submits of the same ids leave one row per id', async () => {
    const rows = [ev('L:0-1', 'trip:L:0-1', 'trip'), ev('L:1-2', 'trip:L:1-2', 'trip')];
    const [a, b] = await Promise.all([
      addRideSegments(rows),
      addRideSegments(rows),
    ]);
    expect(a.length + b.length).toBe(4);
    expect(await eventIds()).toEqual(['trip:L:0-1', 'trip:L:1-2']);
  });
});

describe('markRouteSegments (append by trip)', () => {
  it('returns {added:0} and writes nothing for empty input', async () => {
    expect(await markRouteSegments([], fields('t1'))).toEqual({ added: 0 });
    expect(await getAllEvents()).toHaveLength(0);
  });

  it('appends new trip rows for already-logged segments without touching old rows', async () => {
    await putEvents([ev('L:0-1', 'old-trip:L:0-1', 'old-trip')]);
    const before = (await getAllEvents()).find((e) => e.segmentId === 'L:0-1')!;
    const res = await markRouteSegments(['L:0-1', 'L:1-2'], fields('trip-X'));
    expect(res).toEqual({ added: 2 });
    const all = await getAllEvents();
    expect(all).toHaveLength(3);
    expect(all.find((e) => e.id === before.id)).toEqual(before);
    expect(all.find((e) => e.id === 'trip-X:L:0-1')?.tripId).toBe('trip-X');
    expect(all.find((e) => e.id === 'trip-X:L:1-2')?.tripId).toBe('trip-X');
  });

  it('dedups repeats within a single call', async () => {
    const res = await markRouteSegments(['L:0-1', 'L:0-1', 'L:1-2'], fields('t'));
    expect(res.added).toBe(2);
    expect(await segIds()).toEqual(['L:0-1', 'L:1-2']);
  });

  it('same tripId re-submit is idempotent by deterministic event id', async () => {
    expect(await markRouteSegments(['L:0-1', 'L:1-2'], fields('trip-X'))).toEqual({ added: 2 });
    expect(await markRouteSegments(['L:0-1', 'L:1-2'], fields('trip-X'))).toEqual({ added: 2 });
    const all = await getAllEvents();
    expect(all).toHaveLength(2);
    expect(await eventIds()).toEqual(['trip-X:L:0-1', 'trip-X:L:1-2']);
  });

  it('leaves existing duplicate rows under their original trips', async () => {
    await putEvents([
      ev('L:0-1', 'old-a:L:0-1', 'old-a'),
      ev('L:0-1', 'old-b:L:0-1', 'old-b'),
    ]);
    const res = await markRouteSegments(['L:0-1'], fields('trip-NEW'));
    expect(res).toEqual({ added: 1 });
    const rows = (await getAllEvents()).filter((e) => e.segmentId === 'L:0-1');
    expect(rows).toHaveLength(3);
    expect(rows.map((e) => e.tripId).sort()).toEqual(['old-a', 'old-b', 'trip-NEW']);
  });
});
