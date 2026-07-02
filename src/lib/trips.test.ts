import { describe, it, expect } from 'vitest';
import { summarizeTrips, summarizeDiary, tripEndpoints } from './trips';
import { JP_PACKAGE, stationByName } from './fallback-package';
import { segmentsBetween } from './resolver';
import type { RideEvent } from '../contract/types';

let counter = 0;
function ev(segmentId: string, over: Partial<RideEvent> = {}): RideEvent {
  return {
    id: `e${counter++}`,
    segmentId,
    railGeoVersion: JP_PACKAGE.version,
    source: 'manual',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

const sid = (lineId: string, name: string): string =>
  stationByName(JP_PACKAGE, lineId, name).stationId;

/** Build a trip's worth of events from a single A→B mark (shared tripId). */
function trip(lineId: string, from: string, to: string, over: Partial<RideEvent> = {}): RideEvent[] {
  const segs = segmentsBetween(lineId, sid(lineId, from), sid(lineId, to), JP_PACKAGE);
  const tripId = over.tripId ?? `t${counter++}`;
  return segs.map((segmentId) => ev(segmentId, { ...over, tripId }));
}

describe('summarizeTrips', () => {
  it('groups legs sharing a tripId into one trip with summed distinct km', () => {
    const legs = trip('jr-kururi', '木更津', '横田', { tripId: 'A', createdAt: '2025-03-01T00:00:00.000Z' });
    const trips = summarizeTrips(legs, JP_PACKAGE);
    expect(trips).toHaveLength(1);
    const t = trips[0];
    expect(t.tripId).toBe('A');
    expect(t.solo).toBe(false);
    expect(t.segmentIds).toEqual([
      'jr-kururi:0-1',
      'jr-kururi:1-2',
      'jr-kururi:2-3',
      'jr-kururi:3-4',
    ]);
    const expectedKm =
      Math.round(t.legs.reduce((s, l) => s + l.km, 0) * 100) / 100;
    expect(t.km).toBe(expectedKm);
    expect(t.eventCount).toBe(4);
    expect(t.lineIds).toEqual(['jr-kururi']);
  });

  it('dedupes a segment ridden twice within one trip (counts km once)', () => {
    const tid = 'dup';
    const segId = 'jr-kururi:0-1';
    const trips = summarizeTrips(
      [ev(segId, { tripId: tid }), ev(segId, { tripId: tid })],
      JP_PACKAGE,
    );
    expect(trips).toHaveLength(1);
    expect(trips[0].segmentIds).toEqual([segId]);
    expect(trips[0].eventCount).toBe(2); // raw events counted
    const km = JP_PACKAGE.segments.find((s) => s.segmentId === segId)!.km;
    expect(trips[0].km).toBe(Math.round(km * 100) / 100);
  });

  it('treats an untagged event as its own solo trip', () => {
    const trips = summarizeTrips([ev('jr-kururi:0-1')], JP_PACKAGE);
    expect(trips).toHaveLength(1);
    expect(trips[0].solo).toBe(true);
    expect(trips[0].tripId.startsWith('solo:')).toBe(true);
  });

  it('orders trips by earliest createdAt then tripId, and surfaces date + trainModel', () => {
    const a = trip('jr-kururi', '木更津', '祇園', {
      tripId: 'later',
      createdAt: '2025-05-02T00:00:00.000Z',
      date: '2025-05-02',
      trainModel: 'E235',
    });
    const b = trip('jr-kururi', '祇園', '上総清川', {
      tripId: 'earlier',
      createdAt: '2025-05-01T00:00:00.000Z',
    });
    const trips = summarizeTrips([...a, ...b], JP_PACKAGE);
    expect(trips.map((t) => t.tripId)).toEqual(['earlier', 'later']);
    const later = trips.find((t) => t.tripId === 'later')!;
    expect(later.date).toBe('2025-05-02');
    expect(later.trainModels).toEqual(['E235']);
  });

  it('ignores events whose segment is not in the package', () => {
    const trips = summarizeTrips([ev('ghost-line:0-1', { tripId: 'g' })], JP_PACKAGE);
    expect(trips).toHaveLength(0);
  });

  it('precomputes trip endpoints on the summary (shared index, not a per-trip package scan)', () => {
    const legs = trip('jr-kururi', '木更津', '横田', { tripId: 'A' });
    const [t] = summarizeTrips(legs, JP_PACKAGE);
    const a = sid('jr-kururi', '木更津');
    const b = sid('jr-kururi', '横田');
    expect(new Set([t.fromStationId, t.toStationId])).toEqual(new Set([a, b]));
    // the standalone helper now delegates to the same computation — they agree.
    const ends = tripEndpoints(t, JP_PACKAGE)!;
    expect(new Set([t.fromStationId, t.toStationId])).toEqual(
      new Set([ends.fromStationId, ends.toStationId]),
    );
  });
});

describe('summarizeDiary', () => {
  it('rolls up trip count, total leg km, and the longest trip', () => {
    const short = trip('jr-kururi', '木更津', '祇園', { tripId: 'short' });
    const long = trip('jr-tokaido-shinkansen', '東京', '名古屋', { tripId: 'long' });
    const diary = summarizeDiary([...short, ...long], JP_PACKAGE);
    expect(diary.tripCount).toBe(2);
    expect(diary.longestTripId).toBe('long');
    const sum = diary.trips.reduce((s, t) => s + t.km, 0);
    expect(diary.totalLegKm).toBe(Math.round(sum * 100) / 100);
  });

  it('total leg km double-counts a segment shared by two trips (NOT coverage truth)', () => {
    const segId = 'jr-kururi:0-1';
    const diary = summarizeDiary(
      [ev(segId, { tripId: 't1' }), ev(segId, { tripId: 't2' })],
      JP_PACKAGE,
    );
    const km = JP_PACKAGE.segments.find((s) => s.segmentId === segId)!.km;
    expect(diary.tripCount).toBe(2);
    expect(diary.totalLegKm).toBe(Math.round(km * 2 * 100) / 100);
  });
});

describe('tripEndpoints', () => {
  it('returns the two path ends of a simple A→B trip', () => {
    const legs = trip('jr-kururi', '木更津', '横田', { tripId: 'A' });
    const [t] = summarizeTrips(legs, JP_PACKAGE);
    const ends = tripEndpoints(t, JP_PACKAGE)!;
    const a = sid('jr-kururi', '木更津');
    const b = sid('jr-kururi', '横田');
    expect(new Set([ends.fromStationId, ends.toStationId])).toEqual(new Set([a, b]));
  });

  it('undefined for an empty trip', () => {
    const empty = { ...summarizeTrips([], JP_PACKAGE) } as never;
    void empty;
    const fake = {
      tripId: 'x',
      solo: true,
      segmentIds: [],
      legs: [],
      km: 0,
      lineIds: [],
      trainModels: [],
      createdAt: '',
      eventCount: 0,
    };
    expect(tripEndpoints(fake, JP_PACKAGE)).toBeUndefined();
  });
});
