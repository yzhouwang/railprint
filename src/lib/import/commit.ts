// COMMIT (T4): turn the user's D2 decisions (ImportResolution) + the parsed rows into
// RideEvents and write them through the store.
//
// Rules:
//  • A 'matched' row commits its full span automatically.
//  • A reviewed row commits ONLY if the user confirmed a suggestion; the confirmed
//    segmentId is looked up in that row's `spans` to recover the FULL inter-station
//    expansion (a leg is many segments). Skipped rows commit nothing — never silently
//    dropped, just not written (DESIGN issue 2).
//  • Our-own-export rows preserve source/tripId/date/trainModel/createdAt verbatim;
//    importBatchId is regenerated, but the event id is CONTENT-derived (see below) so the
//    round-trip is lossless AND idempotent regardless of which/when backup file it came from.
//  • Event ids are CONTENT-STABLE so re-importing the same data is idempotent (Dexie bulkPut
//    by id) instead of piling the durable log up on every backup/restore cycle:
//      - own-export rows: a hash of (segmentId, createdAt, source, tripId, date, trainModel),
//        independent of the random batch — two exports of the same ride dedupe.
//      - incumbent rows:  `${importBatchId}:${rawIndex}:${segmentId}`, where importBatchId is
//        now a content hash of the CSV text (parse.ts), so re-importing the same file dedupes.
//  • mode 'merge' → store.addEvents; 'replace' → store.replaceEvents.

import type { RideEvent, RideSource, ImportResolution, RailGeoPackage } from '../../contract/types';
import type { ResolvedRow } from './parse';
import * as store from '../store';
import { hashString } from './hash';

export type ImportMode = 'merge' | 'replace';

/** Incumbent-row id — stable because importBatchId is a content hash of the CSV (parse.ts). */
export function eventId(importBatchId: string, rawIndex: number, segmentId: string): string {
  return `${importBatchId}:${rawIndex}:${segmentId}`;
}

/** Own-export-row id — fully content-addressed, so any backup file of the same ride dedupes. */
function contentEventId(ev: {
  segmentId: string;
  createdAt: string;
  source: string;
  tripId?: string;
  date?: string;
  trainModel?: string;
}): string {
  return `evt-${hashString(
    [ev.segmentId, ev.createdAt, ev.source, ev.tripId ?? '', ev.date ?? '', ev.trainModel ?? ''].join('|'),
  )}`;
}

/**
 * PURE: build the RideEvents a commit would write, given the resolved rows + the user's
 * resolution. No store/db side effects — unit-tested directly.
 */
export function buildImportEvents(
  resolved: ResolvedRow[],
  resolution: ImportResolution,
  pkg: RailGeoPackage | RailGeoPackage[],
): RideEvent[] {
  const pkgs = Array.isArray(pkg) ? pkg : [pkg];
  const fallbackVersion = pkgs[0]?.version ?? '';
  const knownSeg = new Set<string>();
  for (const p of pkgs) for (const s of p.segments) knownSeg.add(s.segmentId);

  const byIndex = new Map<number, ResolvedRow>();
  for (const r of resolved) byIndex.set(r.row.rawIndex, r);

  const skipped = new Set(resolution.skipped);
  // The user's confirmation: rawIndex → chosen suggestion segmentId.
  const confirmedByIndex = new Map<number, string>();
  for (const c of resolution.confirmed) confirmedByIndex.set(c.rawIndex, c.segmentId);

  const createdAtBatch = new Date().toISOString();
  const events: RideEvent[] = [];
  const seenIds = new Set<string>();

  for (const r of resolved) {
    const idx = r.row.rawIndex;
    if (skipped.has(idx)) continue;

    // Which full span are we committing for this row?
    let segmentIds: string[];
    let lineId = r.lineId;
    if (confirmedByIndex.has(idx)) {
      // User confirmed a (possibly non-default) suggestion → expand its full span.
      const chosen = confirmedByIndex.get(idx)!;
      const span = r.spans?.find((s) => s.segmentId === chosen);
      if (span) {
        segmentIds = span.segmentIds;
        lineId = span.lineId;
      } else {
        // Confirmed a bare segmentId we didn't pre-expand (e.g. our-own-export row, or a
        // single-segment suggestion) — commit just that segment if it's real.
        segmentIds = knownSeg.has(chosen) ? [chosen] : [];
      }
    } else if (r.row.matchStatus === 'matched') {
      // Auto-commit a clean match's full span.
      segmentIds = r.segmentIds;
    } else {
      // Review row the user neither confirmed nor explicitly skipped → not committed.
      continue;
    }

    if (segmentIds.length === 0) continue;

    const source: RideSource = r.preserved
      ? coerceSource(r.preserved.source)
      : 'import';
    const railGeoVersion = r.preserved?.railGeoVersion || versionForLine(lineId, pkgs) || fallbackVersion;
    // Re-import (our-own-export): tripId is preserved EXACTLY — an event that had no trip
    // stays trip-less, so the round-trip is lossless. Incumbent import: group this leg's
    // segments under one fresh trip so the resolver's "longest ride" reads the whole leg.
    const tripId = r.preserved ? r.preserved.tripId : `${resolution.importBatchId}:trip:${idx}`;
    const createdAt = r.preserved?.createdAt || createdAtBatch;

    for (const segmentId of segmentIds) {
      // Only commit segments that exist in a loaded package (honesty: a stale/unknown
      // segmentId from a hand-edited CSV is dropped here, not silently "ridden").
      if (!knownSeg.has(segmentId)) continue;
      // Content-addressed for re-imported own-export rows (batch-independent); CSV-hash-
      // stable for incumbent rows. Either way, re-importing the same data overwrites.
      const id = r.preserved
        ? contentEventId({ segmentId, createdAt, source, tripId, date: r.date, trainModel: r.trainModel })
        : eventId(resolution.importBatchId, idx, segmentId);
      if (seenIds.has(id)) continue; // de-dupe within the batch
      seenIds.add(id);
      events.push({
        id,
        segmentId,
        railGeoVersion,
        date: r.date,
        trainModel: r.trainModel,
        source,
        tripId,
        importBatchId: resolution.importBatchId,
        createdAt,
      });
    }
  }

  return events;
}

function coerceSource(s: string): RideSource {
  return s === 'manual' || s === 'corridor' ? s : 'import';
}

function versionForLine(lineId: string | undefined, pkgs: RailGeoPackage[]): string | undefined {
  if (!lineId) return undefined;
  return pkgs.find((p) => p.lines.some((l) => l.lineId === lineId))?.version;
}

/**
 * Build the events and persist them through the store. Returns the events written so the
 * caller can report "N件を取り込みました" and trigger the map-floods-green beat.
 */
export async function commitImport(
  resolved: ResolvedRow[],
  resolution: ImportResolution,
  pkg: RailGeoPackage | RailGeoPackage[],
  mode: ImportMode,
): Promise<RideEvent[]> {
  const events = buildImportEvents(resolved, resolution, pkg);
  if (mode === 'replace') {
    await store.replaceEvents(events);
  } else {
    await store.addEvents(events);
  }
  return events;
}
