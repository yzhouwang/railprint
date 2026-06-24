import { describe, it, expect } from 'vitest';
import type { ImportResolution } from '../../contract/types';
import { buildGeoIndex } from '../store';
import { JP_PACKAGE, STUB_PACKAGES } from '../../fixtures/stubPackage';
import { parseImport, type ResolvedRow } from './parse';
import { buildImportEvents, eventId } from './commit';

const geo = buildGeoIndex(STUB_PACKAGES);

// A realistic incumbent CSV: header drift, a clean match, a transfer ambiguity, junk.
const INCUMBENT_CSV = [
  '路線名,乗車駅,降車駅,乗車日,車両',
  '久留里線,木更津,横田,2025-03-01,キハE130', // clean match (4 segments)
  '東海道新幹線,東京,新大阪,2025-04-10,N700S', // clean HSR match (long)
  ',渋谷,,2025-05-01,', // single transfer station, no line, no dest → review
  '架空鉄道,どこか駅,なにか駅,,', // unmatched junk
].join('\n');

describe('parseImport (incumbent)', () => {
  it('detects columns, matches clean rows, surfaces the rest for review', () => {
    const { report, resolved } = parseImport(INCUMBENT_CSV, STUB_PACKAGES, geo);
    expect(report.total).toBe(4);
    expect(report.matched).toBe(2);
    expect(report.needsReview.length).toBe(2);

    const kururi = resolved[0];
    expect(kururi.row.matchStatus).toBe('matched');
    expect(kururi.segmentIds).toEqual([
      'jr-kururi:0-1',
      'jr-kururi:1-2',
      'jr-kururi:2-3',
      'jr-kururi:3-4',
    ]);
    expect(kururi.date).toBe('2025-03-01');
    expect(kururi.trainModel).toBe('キハE130');
  });

  it('never silently drops an unmatched row', () => {
    const { resolved } = parseImport(INCUMBENT_CSV, STUB_PACKAGES, geo);
    expect(resolved.length).toBe(4);
    expect(resolved[3].row.matchStatus).not.toBe('matched');
  });

  it('returns a fatal report (nothing parsed) for a station/section-less CSV', () => {
    const r = parseImport('適当,メモ\nA,B', STUB_PACKAGES, geo);
    expect(r.fatal).toBeTruthy();
    expect(r.report.total).toBe(0);
  });
});

describe('buildImportEvents', () => {
  const parsed = parseImport(INCUMBENT_CSV, STUB_PACKAGES, geo);
  const batch = parsed.report.importBatchId;

  it('auto-commits matched rows, with one tripId per leg', () => {
    const res: ImportResolution = { importBatchId: batch, confirmed: [], skipped: [] };
    const events = buildImportEvents(parsed.resolved, res, STUB_PACKAGES);
    // 4 (kururi) + 16 (tokaido full line) segments, review rows not committed
    const kururiEvents = events.filter((e) => e.segmentId.startsWith('jr-kururi'));
    expect(kururiEvents.length).toBe(4);
    expect(new Set(kururiEvents.map((e) => e.tripId)).size).toBe(1);
    expect(events.every((e) => e.source === 'import')).toBe(true);
    expect(events.every((e) => e.importBatchId === batch)).toBe(true);
  });

  it('uses STABLE ids so a re-import merge does not duplicate', () => {
    const res: ImportResolution = { importBatchId: batch, confirmed: [], skipped: [] };
    const a = buildImportEvents(parsed.resolved, res, STUB_PACKAGES);
    const b = buildImportEvents(parsed.resolved, res, STUB_PACKAGES);
    expect(a.map((e) => e.id).sort()).toEqual(b.map((e) => e.id).sort());
    const sample = a.find((e) => e.segmentId === 'jr-kururi:0-1')!;
    expect(sample.id).toBe(eventId(batch, 0, 'jr-kururi:0-1'));
  });

  it('commits a confirmed review suggestion as its FULL span, skips skipped rows', () => {
    // Row 2 (渋谷 single station) has suggestions; confirm the first one.
    const reviewRow = parsed.resolved.find((r) => r.row.rawIndex === 2)!;
    const firstSuggestion = reviewRow.row.suggestions?.[0];
    expect(firstSuggestion).toBeTruthy();
    const res: ImportResolution = {
      importBatchId: batch,
      confirmed: [{ rawIndex: 2, segmentId: firstSuggestion!.segmentId }],
      skipped: [3],
    };
    const events = buildImportEvents(parsed.resolved, res, STUB_PACKAGES);
    // the junk row (3) contributes nothing
    expect(events.some((e) => e.segmentId.startsWith('架空'))).toBe(false);
    // the confirmed suggestion contributed at least one real, known segment...
    expect(events.length).toBeGreaterThan(0);
    // ...and every committed segment is REAL (present in a loaded package) — no fabricated
    // segment id leaks through from a single-endpoint review row.
    const known = new Set(STUB_PACKAGES.flatMap((p) => p.segments.map((s) => s.segmentId)));
    expect(events.every((e) => known.has(e.segmentId))).toBe(true);
    // the confirmed single-endpoint suggestion commits exactly its adjacent segment
    expect(events.some((e) => e.segmentId === firstSuggestion!.segmentId)).toBe(true);
  });

  it('drops segments not present in any loaded package (honesty on hand-edited CSV)', () => {
    const fakeRow: ResolvedRow = {
      row: { rawIndex: 99, rawName: 'fake', matchStatus: 'matched', matchedSegmentId: 'no-such:0-1' },
      segmentIds: ['no-such:0-1'],
      lineId: 'no-such',
    };
    const res: ImportResolution = { importBatchId: 'b', confirmed: [], skipped: [] };
    expect(buildImportEvents([fakeRow], res, STUB_PACKAGES)).toEqual([]);
  });
});

describe('re-import idempotency (the backup/restore doubling bug)', () => {
  it('two independent parses of the SAME incumbent CSV produce identical event ids', () => {
    // Each parseImport() mints its own importBatchId — previously random, so the same file
    // re-imported in merge mode appended duplicates. Now the batch id is content-derived.
    const p1 = parseImport(INCUMBENT_CSV, STUB_PACKAGES, geo);
    const p2 = parseImport(INCUMBENT_CSV, STUB_PACKAGES, geo);
    expect(p2.report.importBatchId).toBe(p1.report.importBatchId);
    const r1: ImportResolution = { importBatchId: p1.report.importBatchId, confirmed: [], skipped: [] };
    const r2: ImportResolution = { importBatchId: p2.report.importBatchId, confirmed: [], skipped: [] };
    const a = buildImportEvents(p1.resolved, r1, STUB_PACKAGES);
    const b = buildImportEvents(p2.resolved, r2, STUB_PACKAGES);
    // Merge keys on id (Dexie bulkPut) — identical ids ⇒ the second import overwrites, not doubles.
    const union = new Set([...a, ...b].map((e) => e.id));
    expect(union.size).toBe(a.length);
  });

  it('own-export rows dedupe by CONTENT even across different batch ids', () => {
    const csv = [
      'segmentId,lineId,railGeoVersion,rode,source,tripId,createdAt,date,trainModel',
      `jr-kururi:0-1,久留里線,${JP_PACKAGE.version},1,manual,trip-x,2025-01-02T03:04:05.000Z,2025-01-01,キハ`,
    ].join('\n');
    const p1 = parseImport(csv, STUB_PACKAGES, geo);
    const p2 = parseImport(csv, STUB_PACKAGES, geo);
    // Force DIFFERENT batch ids to prove the dedup is content-addressed, not batch-addressed.
    const a = buildImportEvents(p1.resolved, { importBatchId: 'batchA', confirmed: [], skipped: [] }, STUB_PACKAGES);
    const b = buildImportEvents(p2.resolved, { importBatchId: 'batchB', confirmed: [], skipped: [] }, STUB_PACKAGES);
    expect(a[0].id).toBe(b[0].id);
  });
});

describe('our-own-export fast-path', () => {
  it('detects the export header and maps rows 1:1 with preserved meta', () => {
    const csv = [
      'segmentId,lineId,railGeoVersion,rode,source,tripId,createdAt,date,trainModel',
      `jr-kururi:0-1,久留里線,${JP_PACKAGE.version},1,manual,trip-x,2025-01-02T03:04:05.000Z,2025-01-01,キハ`,
    ].join('\n');
    const { reimport, resolved, report } = parseImport(csv, STUB_PACKAGES, geo);
    expect(reimport).toBe(true);
    expect(report.matched).toBe(1);
    const res: ImportResolution = { importBatchId: report.importBatchId, confirmed: [], skipped: [] };
    const events = buildImportEvents(resolved, res, STUB_PACKAGES);
    expect(events.length).toBe(1);
    const e = events[0];
    expect(e.segmentId).toBe('jr-kururi:0-1');
    expect(e.source).toBe('manual');
    expect(e.tripId).toBe('trip-x');
    expect(e.createdAt).toBe('2025-01-02T03:04:05.000Z');
    expect(e.date).toBe('2025-01-01');
    expect(e.trainModel).toBe('キハ');
    expect(e.railGeoVersion).toBe(JP_PACKAGE.version);
  });
});
