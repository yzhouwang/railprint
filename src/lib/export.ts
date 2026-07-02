// EXPORT (T10): RideEvent[] → CSV string in EXACTLY EXPORT_CSV_COLUMNS order.
//
//   segmentId,lineId,railGeoVersion,rode,source,tripId,createdAt,date,trainModel
//
// • lineId is DERIVED from the segment (human-readable context for the user; re-import
//   ignores it and reconstructs from segmentId).
// • rode is always '1' — every RideEvent is a ridden segment (the column exists so the
//   file reads as a coverage statement, and leaves room for a future "not ridden" flag).
// • The export IS the durable backup-of-record (db.ts header) — re-import must round-trip
//   LOSSLESSLY on the meaningful fields: segmentId, source, tripId, createdAt, date,
//   trainModel, railGeoVersion. id + importBatchId are regenerated on re-import (the
//   export omits id by design; importBatchId is a per-import grouping, not user data).

import { EXPORT_CSV_COLUMNS, type RailGeoPackage, type RideEvent } from '../contract/types';
import type { GeoIndex } from './geo-index';
import { stringifyCsv } from './import/csv';

const COLUMNS = EXPORT_CSV_COLUMNS.split(',') as [
  'segmentId',
  'lineId',
  'railGeoVersion',
  'rode',
  'source',
  'tripId',
  'createdAt',
  'date',
  'trainModel',
];

interface LineNameLookup {
  /** segmentId → human-readable line name (falls back to the lineId, then ''). */
  lineNameFor(segmentId: string): string;
}

/** Build a segmentId → line-name resolver from loaded packages (or a GeoIndex). */
export function lineNameLookup(source: GeoIndex | RailGeoPackage[]): LineNameLookup {
  const segToLineId = new Map<string, string>();
  const lineIdToName = new Map<string, string>();
  if (Array.isArray(source)) {
    for (const p of source) {
      for (const l of p.lines) lineIdToName.set(l.lineId, l.name);
      for (const s of p.segments) segToLineId.set(s.segmentId, s.lineId);
    }
  } else {
    for (const [id, l] of source.lineById) lineIdToName.set(id, l.name);
    for (const [id, s] of source.segmentById) segToLineId.set(id, s.lineId);
  }
  return {
    lineNameFor(segmentId: string): string {
      const lineId = segToLineId.get(segmentId);
      if (!lineId) {
        // Unknown segment (stale geo version): fall back to the lineId prefix of the id.
        return segmentId.split(':')[0] ?? '';
      }
      return lineIdToName.get(lineId) ?? lineId;
    },
  };
}

/**
 * Export events to a CSV string. Deterministic row order (createdAt, then segmentId) so a
 * re-export of the same log is byte-stable — useful for diffing backups.
 */
export function exportEventsToCsv(
  events: RideEvent[],
  geo: GeoIndex | RailGeoPackage[],
): string {
  const lookup = lineNameLookup(geo);
  const sorted = [...events].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    if (a.segmentId !== b.segmentId) return a.segmentId < b.segmentId ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

  const rows: string[][] = [COLUMNS.slice()];
  for (const ev of sorted) {
    rows.push([
      ev.segmentId,
      lookup.lineNameFor(ev.segmentId),
      ev.railGeoVersion,
      '1',
      ev.source,
      ev.tripId ?? '',
      ev.createdAt,
      ev.date ?? '',
      ev.trainModel ?? '',
    ]);
  }
  return stringifyCsv(rows);
}
