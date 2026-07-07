import { describe, it, expect, beforeEach } from 'vitest';
import type { ImportResolution, RideEvent } from '../../contract/types';
import { buildGeoIndex } from '../store';
import { JP_PACKAGE, STUB_PACKAGES } from '../fallback-package';
import { parseImport, type ResolvedRow } from './parse';
import { buildImportEvents, commitImport, eventId } from './commit';
import * as db from '../db';

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

// commitImport dedups an IMPORT row against the EXISTING log by logical ride
// (ride date, segmentId) in merge mode — even when an overlapping export arrives from a
// different file (fresh createdAt/tripId/event id). Manual/corridor marks are append-only
// and must NEVER be deduped. These tests hit the real Dexie kernel (fake-indexeddb).
describe('commitImport — cross-existing dedup (merge mode)', () => {
  beforeEach(async () => {
    await db.clearAll();
  });

  const incumbentCsv = (date: string) =>
    ['路線名,乗車駅,降車駅,乗車日,車両', `久留里線,木更津,横田,${date},キハE130`].join('\n');

  // An own-export CSV for ONE segment ridden on `date`, with a caller-chosen createdAt/tripId
  // and an import source — so it resolves to source 'import' and is dedup-eligible.
  const exportCsv = (opts: { segmentId: string; date: string; createdAt: string; tripId: string; source?: string }) =>
    [
      'segmentId,lineId,railGeoVersion,rode,source,tripId,createdAt,date,trainModel',
      `${opts.segmentId},久留里線,${JP_PACKAGE.version},1,${opts.source ?? 'import'},${opts.tripId},${opts.createdAt},${opts.date},`,
    ].join('\n');

  it('does NOT add a second event when re-importing an OVERLAPPING export of the same (date, segmentId)', async () => {
    // First export of the ride: segment jr-kururi:0-1 ridden 2025-06-01.
    const fileA = exportCsv({
      segmentId: 'jr-kururi:0-1',
      date: '2025-06-01',
      createdAt: '2025-06-01T08:00:00.000Z',
      tripId: 'tripA',
    });
    const pA = parseImport(fileA, STUB_PACKAGES, geo);
    const resA: ImportResolution = { importBatchId: pA.report.importBatchId, confirmed: [], skipped: [] };
    const wroteA = await commitImport(pA.resolved, resA, STUB_PACKAGES, 'merge');
    expect(wroteA).toHaveLength(1);
    expect(await db.getAllEvents()).toHaveLength(1);

    // A SECOND export of the SAME logical ride — different file ⇒ different createdAt, tripId
    // and therefore a different content-derived event id. Without the logical-ride dedup this
    // would append a duplicate diary entry; with it, it must write nothing.
    const fileB = exportCsv({
      segmentId: 'jr-kururi:0-1',
      date: '2025-06-01',
      createdAt: '2025-09-30T23:00:00.000Z',
      tripId: 'tripB',
    });
    const pB = parseImport(fileB, STUB_PACKAGES, geo);
    // sanity: the second file really does mint a different event id.
    const builtB = buildImportEvents(pB.resolved, { importBatchId: 'b', confirmed: [], skipped: [] }, STUB_PACKAGES);
    expect(builtB[0].id).not.toBe(wroteA[0].id);

    const resB: ImportResolution = { importBatchId: pB.report.importBatchId, confirmed: [], skipped: [] };
    const wroteB = await commitImport(pB.resolved, resB, STUB_PACKAGES, 'merge');
    expect(wroteB).toHaveLength(0);
    expect(await db.getAllEvents()).toHaveLength(1);
  });

  it('also dedups an incumbent (fuzzy) re-import against an existing event for the same (date, segmentId)', async () => {
    // Seed the log with the kururi leg via an incumbent import.
    const p1 = parseImport(incumbentCsv('2025-07-04'), STUB_PACKAGES, geo);
    const r1: ImportResolution = { importBatchId: p1.report.importBatchId, confirmed: [], skipped: [] };
    const wrote1 = await commitImport(p1.resolved, r1, STUB_PACKAGES, 'merge');
    expect(wrote1.length).toBe(4);
    const before = (await db.getAllEvents()).length;
    expect(before).toBe(4);

    // Re-import the SAME leg on the SAME day (its batch id is content-stable, so even the
    // event ids match) — nothing new should be written.
    const p2 = parseImport(incumbentCsv('2025-07-04'), STUB_PACKAGES, geo);
    const r2: ImportResolution = { importBatchId: p2.report.importBatchId, confirmed: [], skipped: [] };
    const wrote2 = await commitImport(p2.resolved, r2, STUB_PACKAGES, 'merge');
    expect(wrote2).toHaveLength(0);
    expect((await db.getAllEvents()).length).toBe(before);
  });

  it('PRESERVES a manual repeat-ride on the same day — never deduped away', async () => {
    // A manual mark of the segment already ridden (date 2025-06-01) — same logical key as a
    // prior import, but source 'manual' ⇒ append-only ⇒ both events coexist.
    const importEvent: RideEvent = {
      id: 'imp:0:jr-kururi:0-1',
      segmentId: 'jr-kururi:0-1',
      railGeoVersion: JP_PACKAGE.version,
      date: '2025-06-01',
      source: 'import',
      tripId: 'imp-trip',
      createdAt: '2025-06-01T08:00:00.000Z',
    };
    await db.putEvents([importEvent]);

    // Re-importing an own-export whose source is 'manual' must NOT be dedup-gated.
    const manualReride = exportCsv({
      segmentId: 'jr-kururi:0-1',
      date: '2025-06-01',
      createdAt: '2025-06-01T20:00:00.000Z',
      tripId: 'manual-trip',
      source: 'manual',
    });
    const p = parseImport(manualReride, STUB_PACKAGES, geo);
    const res: ImportResolution = { importBatchId: p.report.importBatchId, confirmed: [], skipped: [] };
    const wrote = await commitImport(p.resolved, res, STUB_PACKAGES, 'merge');

    expect(wrote).toHaveLength(1);
    expect(wrote[0].source).toBe('manual');
    // both the original import event and the manual re-ride survive in the log.
    const all = await db.getAllEvents();
    expect(all).toHaveLength(2);
    expect(all.filter((e) => e.segmentId === 'jr-kururi:0-1')).toHaveLength(2);
  });

  it('does NOT let an existing MANUAL mark shadow an incoming import (no silent drop)', async () => {
    // A manual mark of the segment on 2025-06-01 already in the log.
    const manualEvent: RideEvent = {
      id: 'man:0:jr-kururi:0-1',
      segmentId: 'jr-kururi:0-1',
      railGeoVersion: JP_PACKAGE.version,
      date: '2025-06-01',
      source: 'manual',
      tripId: 'man-trip',
      createdAt: '2025-06-01T08:00:00.000Z',
    };
    await db.putEvents([manualEvent]);

    // Importing the same segment+day must NOT be dropped — dedup is import-vs-import only, so a
    // manual mark never silently shadows an incoming import ride.
    const imp = exportCsv({
      segmentId: 'jr-kururi:0-1',
      date: '2025-06-01',
      createdAt: '2025-06-02T08:00:00.000Z',
      tripId: 'imp-trip',
    });
    const p = parseImport(imp, STUB_PACKAGES, geo);
    const res: ImportResolution = { importBatchId: p.report.importBatchId, confirmed: [], skipped: [] };
    const wrote = await commitImport(p.resolved, res, STUB_PACKAGES, 'merge');

    expect(wrote).toHaveLength(1); // the import ride is kept, not shadowed
    expect(wrote[0].source).toBe('import');
    expect(await db.getAllEvents()).toHaveLength(2); // manual + import coexist
  });

  it('dedups overlapping imports even when the ride date is written in a DIFFERENT format', async () => {
    const fileISO = exportCsv({
      segmentId: 'jr-kururi:0-1',
      date: '2025-06-01',
      createdAt: '2025-06-01T08:00:00.000Z',
      tripId: 'iso',
    });
    const pISO = parseImport(fileISO, STUB_PACKAGES, geo);
    const rISO: ImportResolution = { importBatchId: pISO.report.importBatchId, confirmed: [], skipped: [] };
    await commitImport(pISO.resolved, rISO, STUB_PACKAGES, 'merge');
    expect(await db.getAllEvents()).toHaveLength(1);

    // Same logical day, slash format — canonicalDay folds 2025/6/1 → 2025-06-01, so it dedups.
    const fileSlash = exportCsv({
      segmentId: 'jr-kururi:0-1',
      date: '2025/6/1',
      createdAt: '2025-07-01T08:00:00.000Z',
      tripId: 'slash',
    });
    const pSlash = parseImport(fileSlash, STUB_PACKAGES, geo);
    const rSlash: ImportResolution = { importBatchId: pSlash.report.importBatchId, confirmed: [], skipped: [] };
    const wrote = await commitImport(pSlash.resolved, rSlash, STUB_PACKAGES, 'merge');
    expect(wrote).toHaveLength(0); // different format, same day ⇒ still deduped
    expect(await db.getAllEvents()).toHaveLength(1);
  });

  it('stays idempotent when the EXACT same file is re-imported in merge mode', async () => {
    const file = incumbentCsv('2025-08-15');
    const p1 = parseImport(file, STUB_PACKAGES, geo);
    const r1: ImportResolution = { importBatchId: p1.report.importBatchId, confirmed: [], skipped: [] };
    await commitImport(p1.resolved, r1, STUB_PACKAGES, 'merge');
    const after1 = await db.getAllEvents();

    const p2 = parseImport(file, STUB_PACKAGES, geo);
    const r2: ImportResolution = { importBatchId: p2.report.importBatchId, confirmed: [], skipped: [] };
    await commitImport(p2.resolved, r2, STUB_PACKAGES, 'merge');
    const after2 = await db.getAllEvents();

    expect(after2.length).toBe(after1.length);
    expect(after2.map((e) => e.id).sort()).toEqual(after1.map((e) => e.id).sort());
  });

  it('re-importing our OWN manual export in merge mode is idempotent (no duplicate ride)', async () => {
    // Seed the log exactly the way store.markRide would: the deterministic PK `${tripId}:${segmentId}`.
    const original: RideEvent = {
      id: 'trip-x:jr-kururi:0-1',
      segmentId: 'jr-kururi:0-1',
      railGeoVersion: JP_PACKAGE.version,
      date: '2025-01-01',
      source: 'manual',
      tripId: 'trip-x',
      createdAt: '2025-01-02T03:04:05.000Z',
    };
    await db.putEvents([original]);
    expect(await db.getAllEvents()).toHaveLength(1);

    // Back it up and restore-merge (our own export schema, same preserved identity).
    const backup = exportCsv({
      segmentId: 'jr-kururi:0-1',
      date: '2025-01-01',
      createdAt: '2025-01-02T03:04:05.000Z',
      tripId: 'trip-x',
      source: 'manual',
    });
    const p = parseImport(backup, STUB_PACKAGES, geo);
    const res: ImportResolution = { importBatchId: p.report.importBatchId, confirmed: [], skipped: [] };
    await commitImport(p.resolved, res, STUB_PACKAGES, 'merge');

    // Before the fix, a manual restore minted a fresh `evt-…` id AND was exempt from the dedup, so
    // every restore doubled the diary. Now the original `${tripId}:${segmentId}` id is reconstructed
    // (and the exact-identity net catches the trip-less case), so the restore is a no-op.
    const all = await db.getAllEvents();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('trip-x:jr-kururi:0-1');
    expect(all[0].source).toBe('manual');
  });

  it('replace mode wipes the log first, so no cross-existing dedup is applied', async () => {
    // Pre-existing event with a logical key that an incoming import would also produce.
    await db.putEvents([
      {
        id: 'old:jr-kururi:0-1',
        segmentId: 'jr-kururi:0-1',
        railGeoVersion: JP_PACKAGE.version,
        date: '2025-03-01',
        source: 'import',
        tripId: 'old',
        createdAt: '2025-03-01T00:00:00.000Z',
      },
    ]);
    const p = parseImport(incumbentCsv('2025-03-01'), STUB_PACKAGES, geo);
    const res: ImportResolution = { importBatchId: p.report.importBatchId, confirmed: [], skipped: [] };
    const wrote = await commitImport(p.resolved, res, STUB_PACKAGES, 'replace');

    // replace builds the full span and the old event is gone — the log is exactly the import.
    expect(wrote.length).toBe(4);
    const all = await db.getAllEvents();
    expect(all.length).toBe(4);
    expect(all.some((e) => e.id === 'old:jr-kururi:0-1')).toBe(false);
  });
});
