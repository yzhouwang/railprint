// Dexie kernel (T5). Opus 4.8 / experience lane is the SOLE owner of this schema and
// its version number — no parallel bumps (ORCHESTRATION collision rule).
//
// SINGLE DURABLE SOURCE OF TRUTH = the `rideEvents` log. The "coverage set" from the
// design is the resolver-DERIVED projection of those events (CoverageResult.litSegmentIds),
// not a second persisted table — one source means the lifetime ride log can never drift
// out of sync with the % shown, which is the corruption mode this kernel exists to avoid.
// The durable backup-of-record lives outside IndexedDB: the exported CSV (T10).

import Dexie, { type Table } from 'dexie';
import type { RideEvent, RideSource } from '../contract/types';

export interface MetaRow {
  key: string;
  value: unknown;
}

export class RailPrintDB extends Dexie {
  rideEvents!: Table<RideEvent, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'railprint') {
    super(name);
    // v1 — initial schema. Indexes: PK id; secondary on the fields we query by
    // (segment membership, undo-an-import, trip grouping, recency).
    this.version(1).stores({
      rideEvents: 'id, segmentId, importBatchId, tripId, date, railGeoVersion, createdAt',
      meta: 'key',
    });
  }
}

export const db = new RailPrintDB();

/** Stable UUID for a new ride event. */
export function newId(): string {
  return crypto.randomUUID();
}

// ─────────────────────────────── event log ──────────────────────────────────

export async function getAllEvents(): Promise<RideEvent[]> {
  return db.rideEvents.toArray();
}

/** Insert/overwrite events by id (id is the PK; same id is idempotent). */
export async function putEvents(events: RideEvent[]): Promise<void> {
  if (events.length === 0) return;
  await db.rideEvents.bulkPut(events);
}

/**
 * Atomically persist ride events at journey grain. The rideEvents log is append-only by
 * trip/event id: a repeat ride over an already-covered segment is still a real diary event.
 * Dedup only within this batch by primary key so a double-submit overwrites the same events,
 * while a new tripId's ids append new rows.
 */
export async function addRideSegments(candidates: RideEvent[]): Promise<RideEvent[]> {
  if (candidates.length === 0) return [];
  return db.transaction('rw', db.rideEvents, async () => {
    const seen = new Set<string>();
    const rows = candidates.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
    if (rows.length) await db.rideEvents.bulkPut(rows);
    return rows;
  });
}

/**
 * Persist a whole route (multiple legs) as ONE new trip at journey grain. Segment coverage is
 * derived downstream and dedups by segmentId, so appending a repeat ride preserves the diary
 * without changing coverage %. The deterministic id `${tripId}:${segmentId}` makes a re-submit
 * of the same trip idempotent, while a fresh tripId appends another journey over the same legs.
 * Atomic + concurrency-safe (one rw txn).
 *
 * `kmBySegmentId` is the Phase-4 durability snapshot: the caller (store.markRoute) supplies each
 * leg's km at record time, mirroring the direct markRide path, so a route-marked ride keeps its
 * distance even after the segment is later abolished (quarantine display + closedLineKm both read
 * the snapshot, never the by-then-gone segment record).
 */
export async function markRouteSegments(
  segmentIds: string[],
  fields: {
    railGeoVersion: string;
    date?: string;
    trainModel?: string;
    source: RideSource;
    tripId: string;
    createdAt: string;
  },
  kmBySegmentId?: ReadonlyMap<string, number | undefined>,
): Promise<{ added: number }> {
  if (segmentIds.length === 0) return { added: 0 };
  return db.transaction('rw', db.rideEvents, async () => {
    const rows: RideEvent[] = [];
    const seen = new Set<string>();
    for (const segmentId of segmentIds) {
      if (seen.has(segmentId)) continue; // in-call dedup
      seen.add(segmentId);
      rows.push({
        id: `${fields.tripId}:${segmentId}`,
        segmentId,
        railGeoVersion: fields.railGeoVersion,
        km: kmBySegmentId?.get(segmentId),
        date: fields.date,
        trainModel: fields.trainModel,
        source: fields.source,
        tripId: fields.tripId,
        createdAt: fields.createdAt,
      });
    }
    if (rows.length) await db.rideEvents.bulkPut(rows);
    return { added: rows.length };
  });
}

export async function deleteEvents(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.rideEvents.bulkDelete(ids);
}

/** Remove every event from one import batch — backs "undo this import". */
export async function deleteImportBatch(importBatchId: string): Promise<number> {
  return db.rideEvents.where('importBatchId').equals(importBatchId).delete();
}

/** Remove every event from one trip — backs undoing a just-made journey. */
export async function deleteTrip(tripId: string): Promise<number> {
  return db.rideEvents.where('tripId').equals(tripId).delete();
}

/** Replace the entire log atomically (merge-vs-replace = replace). */
export async function replaceAllEvents(events: RideEvent[]): Promise<void> {
  await db.transaction('rw', db.rideEvents, async () => {
    await db.rideEvents.clear();
    if (events.length) await db.rideEvents.bulkPut(events);
  });
}

export async function clearAll(): Promise<void> {
  await db.transaction('rw', db.rideEvents, db.meta, async () => {
    await db.rideEvents.clear();
    await db.meta.clear();
  });
}

// ──────────────────────────────── meta kv ───────────────────────────────────

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
