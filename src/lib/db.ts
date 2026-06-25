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
 * Atomically persist ride events for segments not already present in the log. The dedup read
 * and the insert run in ONE rw transaction, so two concurrent marks of the same segment can't
 * both write it: the second serializes behind the first's commit and sees it already present.
 * Returns ONLY the events actually inserted — callers size the km toast off this, not the
 * pre-transaction snapshot, so a race can never over-count.
 */
export async function addRideSegments(candidates: RideEvent[]): Promise<RideEvent[]> {
  if (candidates.length === 0) return [];
  return db.transaction('rw', db.rideEvents, async () => {
    const ids = candidates.map((e) => e.segmentId);
    // Seed with the already-persisted segments, then add each fresh segmentId as it passes —
    // so the filter dedups against BOTH the log AND repeats within this candidate set (a caller
    // that passes the same segmentId twice can't self-duplicate, independent of segmentsBetween).
    const seen = new Set(
      (await db.rideEvents.where('segmentId').anyOf(ids).toArray()).map((e) => e.segmentId),
    );
    const fresh = candidates.filter((e) => (seen.has(e.segmentId) ? false : (seen.add(e.segmentId), true)));
    if (fresh.length) await db.rideEvents.bulkAdd(fresh);
    return fresh;
  });
}

/**
 * Persist a whole route (multiple legs) as ONE trip. Existing legs are RE-STAMPED IN PLACE — their
 * tripId is updated (and date/trainModel filled only if absent), keeping the same row id, so the
 * durable log stays one-event-per-segment. This is NOT the v0.2.0.0 bug: that was a duplicate INSERT
 * of an already-ridden segment; this is an UPDATE by primary key (bulkPut on the existing id). Missing
 * legs are inserted. The most-recent marking re-groups overlapping legs into the new trip (D6-B).
 * Returns how many legs were freshly added vs re-stamped. Atomic + concurrency-safe (one rw txn).
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
): Promise<{ added: number; restamped: number }> {
  if (segmentIds.length === 0) return { added: 0, restamped: 0 };
  return db.transaction('rw', db.rideEvents, async () => {
    const present = await db.rideEvents.where('segmentId').anyOf(segmentIds).toArray();
    // segmentId is a NON-unique index — the log can hold >1 row per segment (e.g. two import batches).
    // Group ALL rows per segment so the re-stamp re-groups every one of them; collapsing to a single
    // row (a Map) would strand the duplicates under their old trip.
    const presentBySeg = new Map<string, RideEvent[]>();
    for (const e of present) {
      const list = presentBySeg.get(e.segmentId);
      if (list) list.push(e);
      else presentBySeg.set(e.segmentId, [e]);
    }
    const restamp: RideEvent[] = [];
    const inserts: RideEvent[] = [];
    const seen = new Set<string>();
    for (const segmentId of segmentIds) {
      if (seen.has(segmentId)) continue; // in-call dedup
      seen.add(segmentId);
      const existing = presentBySeg.get(segmentId);
      if (existing && existing.length) {
        // re-stamp the grouping in place on EVERY existing row; keep id + createdAt, and don't clobber
        // an existing leg's own ride date/train (only fill when it had none) — the trip groups them,
        // it doesn't rewrite when each leg was ridden.
        for (const e of existing) {
          restamp.push({
            ...e,
            tripId: fields.tripId,
            date: e.date ?? fields.date,
            trainModel: e.trainModel ?? fields.trainModel,
          });
        }
      } else {
        inserts.push({
          id: newId(),
          segmentId,
          railGeoVersion: fields.railGeoVersion,
          date: fields.date,
          trainModel: fields.trainModel,
          source: fields.source,
          tripId: fields.tripId,
          createdAt: fields.createdAt,
        });
      }
    }
    if (restamp.length) await db.rideEvents.bulkPut(restamp); // bulkPut by id == update in place
    if (inserts.length) await db.rideEvents.bulkAdd(inserts);
    return { added: inserts.length, restamped: restamp.length };
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
