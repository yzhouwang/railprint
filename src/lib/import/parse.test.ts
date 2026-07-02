// Unit tests for parse.ts's fuzzy resolution (T4): incumbent-row matching, ambiguous /
// review-span suggestions, the our-own-export re-import fast-path, and malformed/blank-row
// rejection. These assert real, load-bearing behaviour — never `toBeDefined()`.

import { describe, it, expect } from 'vitest';
import { buildGeoIndex } from '../store';
import { JP_PACKAGE, STUB_PACKAGES } from '../fallback-package';
import { EXPORT_CSV_COLUMNS } from '../../contract/types';
import { parseImport, isOurExport } from './parse';

const geo = buildGeoIndex(STUB_PACKAGES);

// Every real segmentId across the loaded packages — used to prove no fabricated id leaks.
const KNOWN_SEG = new Set(STUB_PACKAGES.flatMap((p) => p.segments.map((s) => s.segmentId)));

describe('parseImport — incumbent-row matching', () => {
  it('expands a clean A→B leg on one line into its FULL ordered segment span', () => {
    // 久留里線 木更津(seq0)→横田(seq4): four consecutive inter-station segments.
    const csv = ['路線名,乗車駅,降車駅,乗車日,車両', '久留里線,木更津,横田,2025-03-01,キハE130'].join('\n');
    const { resolved, report } = parseImport(csv, STUB_PACKAGES, geo);

    expect(report.total).toBe(1);
    expect(report.matched).toBe(1);
    expect(report.needsReview).toHaveLength(0);

    const row = resolved[0];
    expect(row.row.matchStatus).toBe('matched');
    expect(row.lineId).toBe('jr-kururi');
    expect(row.segmentIds).toEqual([
      'jr-kururi:0-1',
      'jr-kururi:1-2',
      'jr-kururi:2-3',
      'jr-kururi:3-4',
    ]);
    // the contract row carries the first segment; the full span lives on ResolvedRow.
    expect(row.row.matchedSegmentId).toBe('jr-kururi:0-1');
    // ride meta is carried through from the detected date/model columns.
    expect(row.date).toBe('2025-03-01');
    expect(row.trainModel).toBe('キハE130');
  });

  it('reads a 区間 "A〜B" span cell when there is no explicit from/to column', () => {
    const csv = ['路線,区間,日付', '東海道新幹線,東京〜品川,2025-04-10'].join('\n');
    const { resolved, report } = parseImport(csv, STUB_PACKAGES, geo);

    expect(report.matched).toBe(1);
    const row = resolved[0];
    expect(row.row.matchStatus).toBe('matched');
    expect(row.lineId).toBe('jr-tokaido-shinkansen');
    // 東京(seq0)→品川(seq1) is one segment.
    expect(row.segmentIds).toEqual(['jr-tokaido-shinkansen:0-1']);
  });

  it('surfaces a same-line endpoint pair with no path as review, not a false match', () => {
    // Endpoints resolve, but 木更津 is on 久留里線 while 東京 is not → cannot form a leg.
    const csv = ['路線名,乗車駅,降車駅', '久留里線,木更津,東京'].join('\n');
    const { resolved, report } = parseImport(csv, STUB_PACKAGES, geo);
    expect(report.matched).toBe(0);
    expect(resolved[0].row.matchStatus).not.toBe('matched');
  });
});

describe('parseImport — ambiguous / review-span suggestions', () => {
  it('offers ranked suggestions whose full span is recoverable for a transfer ambiguity', () => {
    // 渋谷 lives on both 山手線 and 東急東横線; 自由が丘 is 東急東横線-only. The resolver should
    // surface the 東急東横線 span as a confirmable suggestion (review, not auto-matched).
    const csv = ['路線名,乗車駅,降車駅', ',渋谷,自由が丘'].join('\n');
    const { resolved, report } = parseImport(csv, STUB_PACKAGES, geo);

    expect(report.matched).toBe(0);
    const row = resolved[0];
    expect(row.row.matchStatus).toBe('ambiguous');
    expect(row.row.suggestions && row.row.suggestions.length).toBeGreaterThan(0);

    // Suggestions are ranked by descending confidence.
    const confs = row.row.suggestions!.map((s) => s.confidence);
    expect([...confs].sort((a, b) => b - a)).toEqual(confs);

    // Every suggestion key has a recoverable full span behind it (what commit re-expands),
    // and every segment in that span is a real, known segment on 東急東横線.
    expect(row.spans && row.spans.length).toBe(row.row.suggestions!.length);
    const toyoko = row.spans!.find((s) => s.lineId === 'tokyu-toyoko');
    expect(toyoko).toBeTruthy();
    expect(toyoko!.segmentIds.length).toBeGreaterThan(1);
    expect(toyoko!.segmentIds.every((id) => KNOWN_SEG.has(id))).toBe(true);
    // the suggestion's key is the first segment of its span (commit's lookup contract).
    expect(toyoko!.segmentId).toBe(toyoko!.segmentIds[0]);
  });

  it('makes a single-endpoint row review-only, suggesting one real adjacent segment per candidate', () => {
    // Only a boarding station, no destination → cannot form a leg, but never dropped.
    const csv = ['路線名,乗車駅,降車駅', ',渋谷,'].join('\n');
    const { resolved } = parseImport(csv, STUB_PACKAGES, geo);

    const row = resolved[0];
    expect(row.row.matchStatus).toBe('ambiguous');
    expect(row.spans && row.spans.length).toBeGreaterThan(0);
    // each candidate contributes exactly ONE real adjacent segment (the 隣駅まで span).
    for (const span of row.spans!) {
      expect(span.segmentIds).toHaveLength(1);
      expect(KNOWN_SEG.has(span.segmentIds[0])).toBe(true);
    }
  });

  it('keeps a row that resolves to no real suggestion as unmatched (never dropped)', () => {
    const csv = ['路線名,乗車駅,降車駅', '架空鉄道,どこか駅,なにか駅'].join('\n');
    const { resolved, report } = parseImport(csv, STUB_PACKAGES, geo);
    expect(report.total).toBe(1);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].row.matchStatus).toBe('unmatched');
    expect(resolved[0].segmentIds).toHaveLength(0);
  });
});

describe('parseImport — our-own-export re-import fast-path', () => {
  it('detects the exact export header and only the exact header', () => {
    expect(isOurExport(EXPORT_CSV_COLUMNS.split(','))).toBe(true);
    // wrong order / extra column / drift all fail.
    expect(isOurExport(['lineId', 'segmentId'])).toBe(false);
    expect(isOurExport([...EXPORT_CSV_COLUMNS.split(','), 'extra'])).toBe(false);
    expect(isOurExport(['路線名', '乗車駅'])).toBe(false);
  });

  it('round-trips an export row 1:1, preserving source/tripId/createdAt verbatim (no fuzzy matching)', () => {
    const csv = [
      EXPORT_CSV_COLUMNS,
      `jr-kururi:0-1,久留里線,${JP_PACKAGE.version},1,manual,trip-x,2025-01-02T03:04:05.000Z,2025-01-01,キハ`,
    ].join('\n');
    const { reimport, resolved, report } = parseImport(csv, STUB_PACKAGES, geo);

    expect(reimport).toBe(true);
    expect(report.matched).toBe(1);
    const row = resolved[0];
    expect(row.row.matchStatus).toBe('matched');
    expect(row.segmentIds).toEqual(['jr-kururi:0-1']);
    expect(row.preserved).toEqual({
      railGeoVersion: JP_PACKAGE.version,
      source: 'manual',
      tripId: 'trip-x',
      createdAt: '2025-01-02T03:04:05.000Z',
    });
    expect(row.date).toBe('2025-01-01');
    expect(row.trainModel).toBe('キハ');
  });

  it('marks an export row whose segmentId is unknown to the loaded packages as unmatched', () => {
    const csv = [
      EXPORT_CSV_COLUMNS,
      `no-such:9-9,幻の線,${JP_PACKAGE.version},1,import,,2025-01-02T03:04:05.000Z,2025-01-01,`,
    ].join('\n');
    const { reimport, resolved, report } = parseImport(csv, STUB_PACKAGES, geo);

    expect(reimport).toBe(true);
    expect(report.matched).toBe(0);
    expect(resolved[0].row.matchStatus).toBe('unmatched');
    expect(resolved[0].segmentIds).toHaveLength(0);
  });
});

describe('parseImport — malformed / blank-row rejection', () => {
  it('returns a fatal report for a completely empty file', () => {
    const r = parseImport('', STUB_PACKAGES, geo);
    expect(r.fatal).toBeTruthy();
    expect(r.report.total).toBe(0);
    expect(r.resolved).toHaveLength(0);
  });

  it('returns a fatal report for a header-only file (no data rows)', () => {
    const r = parseImport('路線名,乗車駅,降車駅', STUB_PACKAGES, geo);
    expect(r.fatal).toBeTruthy();
    expect(r.report.total).toBe(0);
  });

  it('returns a fatal report when no station/section column is detectable', () => {
    const r = parseImport('適当,メモ\nA,B', STUB_PACKAGES, geo);
    expect(r.fatal).toBeTruthy();
    expect(r.report.total).toBe(0);
  });

  it('keeps a blank data row inside an otherwise valid file — unmatched, never silently dropped', () => {
    const csv = [
      '路線名,乗車駅,降車駅,乗車日',
      '久留里線,木更津,横田,2025-03-01', // a real match
      ',,,', // a blank row
    ].join('\n');
    const { resolved, report } = parseImport(csv, STUB_PACKAGES, geo);

    expect(report.total).toBe(2);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].row.matchStatus).toBe('matched');
    // the blank row survives as an honest unmatched row with a placeholder name.
    expect(resolved[1].row.matchStatus).toBe('unmatched');
    expect(resolved[1].segmentIds).toHaveLength(0);
    expect(resolved[1].row.rawName).toBe('(空の行)');
  });
});
