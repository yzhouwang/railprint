// T11 — group manual ride legs into trips + summarize trips for a diary.
//
// PURE helpers only (unit-tested). A "trip" is the set of RideEvents that share a
// `tripId` (markRide already stamps one tripId per A→B slice). An event with NO
// tripId is its own singleton trip (keyed `solo:<id>`), matching the resolver's
// longestRide grouping so the two never disagree. Distance for a trip is the SUM of
// the DISTINCT ridden segments' build-time km (zero turf, zero geometry re-derivation
// — we only look up RailSegment.km via the package). A segment counted once per trip.

import type { RailGeoPackage, RailSegment, RideEvent } from '../contract/types';

export interface TripLeg {
  segmentId: string;
  lineId: string;
  km: number;
  isHSR: boolean;
}

export interface TripSummary {
  tripId: string;
  /** true when this trip is a single untagged event (no shared tripId). */
  solo: boolean;
  /** distinct segmentIds in this trip, in package order (deterministic). */
  segmentIds: string[];
  legs: TripLeg[];
  /** sum of distinct segment km (rounded to 2dp). */
  km: number;
  /** lineIds touched, sorted (a trip usually rides one line, but imports may span). */
  lineIds: string[];
  /** distinct train models seen on the trip, sorted; [] if none recorded. */
  trainModels: string[];
  /** earliest dated event on the trip, if any leg carried a date. */
  date?: string;
  /** earliest createdAt across the trip's events (stable ordering key). */
  createdAt: string;
  /** count of underlying ride events (legs may dedupe; this counts raw events). */
  eventCount: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Group ride events into trips by shared tripId. Untagged events each become their
 * own `solo:<id>` trip. Only events whose segment exists in `pkg` are considered
 * (cross-package events are summarized against their own package). Order of trips is
 * deterministic: by earliest createdAt, then tripId.
 */
export function summarizeTrips(events: RideEvent[], pkg: RailGeoPackage): TripSummary[] {
  const segById = new Map<string, RailSegment>(pkg.segments.map((s) => [s.segmentId, s]));
  // Package order index — gives segmentIds a stable, geometry-faithful sort.
  const segOrder = new Map<string, number>();
  pkg.segments.forEach((s, i) => segOrder.set(s.segmentId, i));

  interface Bucket {
    tripId: string;
    solo: boolean;
    segmentIds: Set<string>;
    trainModels: Set<string>;
    dates: string[];
    createdAts: string[];
    eventCount: number;
  }
  const buckets = new Map<string, Bucket>();

  for (const ev of events) {
    if (!segById.has(ev.segmentId)) continue; // not in this package
    const solo = !ev.tripId;
    const key = ev.tripId ?? `solo:${ev.id}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        tripId: key,
        solo,
        segmentIds: new Set(),
        trainModels: new Set(),
        dates: [],
        createdAts: [],
        eventCount: 0,
      };
      buckets.set(key, b);
    }
    b.segmentIds.add(ev.segmentId);
    if (ev.trainModel) b.trainModels.add(ev.trainModel);
    if (ev.date) b.dates.push(ev.date);
    b.createdAts.push(ev.createdAt);
    b.eventCount++;
  }

  const summaries: TripSummary[] = [];
  for (const b of buckets.values()) {
    const segmentIds = [...b.segmentIds].sort(
      (a, c) => (segOrder.get(a) ?? 0) - (segOrder.get(c) ?? 0),
    );
    const legs: TripLeg[] = segmentIds.map((id) => {
      const seg = segById.get(id)!;
      return { segmentId: id, lineId: seg.lineId, km: seg.km, isHSR: seg.isHSR };
    });
    const km = round2(legs.reduce((sum, l) => sum + l.km, 0));
    const lineIds = [...new Set(legs.map((l) => l.lineId))].sort();
    const date = b.dates.length ? [...b.dates].sort()[0] : undefined;
    const createdAt = [...b.createdAts].sort()[0];
    summaries.push({
      tripId: b.tripId,
      solo: b.solo,
      segmentIds,
      legs,
      km,
      lineIds,
      trainModels: [...b.trainModels].sort(),
      date,
      createdAt,
      eventCount: b.eventCount,
    });
  }

  summaries.sort((a, c) =>
    a.createdAt === c.createdAt
      ? a.tripId.localeCompare(c.tripId)
      : a.createdAt.localeCompare(c.createdAt),
  );
  return summaries;
}

export interface TripDiary {
  trips: TripSummary[];
  tripCount: number;
  /** sum of per-trip km — NOT national coverage (a segment ridden on two trips counts twice). */
  totalLegKm: number;
  longestTripId?: string;
}

/**
 * A diary view over trips: ordered trips + a few rollups for a "trips" panel. This is
 * a presentation rollup, NOT the coverage truth — coverage de-dupes across the whole
 * log (resolveCoverage), whereas a diary intentionally lists each journey you took.
 */
export function summarizeDiary(events: RideEvent[], pkg: RailGeoPackage): TripDiary {
  const trips = summarizeTrips(events, pkg);
  let totalLegKm = 0;
  let longestTripId: string | undefined;
  let longestKm = -1;
  for (const t of trips) {
    totalLegKm += t.km;
    if (t.km > longestKm) {
      longestKm = t.km;
      longestTripId = t.tripId;
    }
  }
  return {
    trips,
    tripCount: trips.length,
    totalLegKm: round2(totalLegKm),
    longestTripId,
  };
}

/**
 * Human label for a trip's endpoints, derived from the package's station order — used
 * by a diary row ("東京 → 横田 · 4区間"). Endpoints are the two stations that touch
 * exactly one leg (a simple path); falls back to the longest leg for loops/branches.
 * Pure name lookup; never measures track.
 */
export function tripEndpoints(
  trip: TripSummary,
  pkg: RailGeoPackage,
): { fromStationId: string; toStationId: string } | undefined {
  if (trip.legs.length === 0) return undefined;
  const segById = new Map<string, RailSegment>(pkg.segments.map((s) => [s.segmentId, s]));
  const touch = new Map<string, number>();
  for (const id of trip.segmentIds) {
    const s = segById.get(id);
    if (!s) continue;
    touch.set(s.fromStationId, (touch.get(s.fromStationId) ?? 0) + 1);
    touch.set(s.toStationId, (touch.get(s.toStationId) ?? 0) + 1);
  }
  const ends = [...touch.entries()].filter(([, c]) => c === 1).map(([id]) => id);
  if (ends.length === 2) {
    const [from, to] = [...ends].sort();
    return { fromStationId: from, toStationId: to };
  }
  // Loop / branch / singleton: longest leg's endpoints.
  let max = segById.get(trip.segmentIds[0]);
  for (const id of trip.segmentIds) {
    const s = segById.get(id);
    if (s && (!max || s.km > max.km)) max = s;
  }
  return max ? { fromStationId: max.fromStationId, toStationId: max.toStationId } : undefined;
}
