// PARSE (T4): an incumbent CSV → ParsedRideRow[] + ImportReport.
//
// The incumbent world (乗りつぶしオンライン / RailLab) has no fixed schema — column
// headers drift in wording and order. We detect Japanese-ish columns by keyword:
//   路線 / 路線名            → line name
//   区間                     → "from〜to" in one cell, OR
//   駅 / 乗車駅+降車駅 / from+to → endpoint stations
//   日付 / 乗車日 / date      → ride date
//   車両 / 形式 / model       → train model
//   緯度/経度 / lat/lon       → optional coordinates (proximity tie-break)
//
// A row is one ride leg (A→B on a line). We resolve both endpoints through the crosswalk,
// then expand A→B to segmentIds via the resolver's segmentsBetween. A row matches cleanly
// only when BOTH endpoints resolve to the SAME line and a path exists; anything else is
// surfaced to the human review screen (D2) — NEVER silently dropped (DESIGN issue 2).
//
// We ALSO fast-path re-import of OUR OWN export (EXPORT_CSV_COLUMNS): that file maps 1:1
// to RideEvents with no fuzzy matching, so it must round-trip losslessly (T10).

import {
  EXPORT_CSV_COLUMNS,
  type MatchStatus,
  type ParsedRideRow,
  type ImportReport,
  type RailGeoPackage,
} from '../../contract/types';
import type { GeoIndex } from '../store';
import { parseCsv } from './csv';
import { resolveStation, type CrosswalkInput } from './crosswalk';
import { segmentsBetween } from '../resolver';
import { hashString } from './hash';

// ───────────────────────────── column detection ─────────────────────────────

type ColRole =
  | 'line'
  | 'span' // 区間: "A〜B" in one cell
  | 'from'
  | 'to'
  | 'station' // a single station cell (point ride, or ambiguous A/B)
  | 'date'
  | 'model'
  | 'lon'
  | 'lat'
  | null;

const HEADER_PATTERNS: { role: Exclude<ColRole, null>; test: RegExp }[] = [
  { role: 'line', test: /路線|line|ライン/i },
  { role: 'span', test: /区間|section|span/i },
  { role: 'from', test: /乗車駅|出発|始|from|起点|発駅/i },
  { role: 'to', test: /降車駅|到着|着|to|終点|着駅/i },
  { role: 'date', test: /日付|乗車日|乗車年月日|date|日時/i },
  { role: 'model', test: /車両|形式|車種|model|train/i },
  { role: 'lon', test: /経度|lon|lng|longitude/i },
  { role: 'lat', test: /緯度|lat|latitude/i },
  // Generic single-station column — checked LAST so 乗車駅/from win first.
  { role: 'station', test: /駅|station/i },
];

interface ColumnMap {
  roleOf: (Exclude<ColRole, null> | null)[]; // index → role
  has: Set<Exclude<ColRole, null>>;
}

function detectColumns(header: string[]): ColumnMap {
  const roleOf: (Exclude<ColRole, null> | null)[] = header.map((h) => {
    const cell = h.trim();
    for (const { role, test } of HEADER_PATTERNS) {
      if (test.test(cell)) return role;
    }
    return null;
  });
  const has = new Set<Exclude<ColRole, null>>();
  for (const r of roleOf) if (r) has.add(r);
  return { roleOf, has };
}

// ───────────────────────────── span splitting ───────────────────────────────

// 区間 cells use a few separators between endpoints: 〜 ～ ~ − - – — → ⇒ .
// DELIBERATELY excludes the katakana prolonged-sound mark ー (U+30FC): it looks dash-like but
// is a LETTER inside ordinary station names (ニュータウン, シーサイドライン, スカイライナー),
// so treating it as a span separator shreds those names mid-word (e.g. シーサイドライン →
// シ / サイドライン). Genuine span glyphs only: wave/full/ASCII tilde, minus, hyphen, en/em
// dash, and the arrow forms below.
const SPAN_SEP = /[〜～~−\-—–]|->|→|=>|＝＞/;

function splitSpan(cell: string): { from: string; to: string } | null {
  const m = cell.split(SPAN_SEP).map((s) => s.trim()).filter(Boolean);
  if (m.length >= 2) return { from: m[0], to: m[m.length - 1] };
  return null;
}

// ───────────────────────────── our-own-export detection ─────────────────────

const EXPORT_HEADER = EXPORT_CSV_COLUMNS.split(',');

/** True iff the header is EXACTLY our T10 export schema (order + names). */
export function isOurExport(header: string[]): boolean {
  if (header.length !== EXPORT_HEADER.length) return false;
  return header.every((h, i) => h.trim() === EXPORT_HEADER[i]);
}

// ───────────────────────────── parse result ─────────────────────────────────

/**
 * The full per-row resolution the commit step needs. Mirrors ParsedRideRow (which the
 * contract caps at a single matchedSegmentId) but carries the FULL expanded segment list
 * for a multi-segment leg, the resolved line, and the source meta to preserve on re-import.
 */
export interface SpanOption {
  /** the suggestion key shown in ParsedRideRow.suggestions[].segmentId. */
  segmentId: string;
  /** full inter-station expansion confirming this suggestion commits. */
  segmentIds: string[];
  lineId: string;
}

export interface ResolvedRow {
  row: ParsedRideRow;
  /** the BEST expansion (== spans[0]?.segmentIds); commit uses this if confirmed as-is. */
  segmentIds: string[];
  lineId?: string;
  date?: string;
  trainModel?: string;
  /**
   * For review rows: every suggested span keyed by its suggestion segmentId, so D2 can
   * confirm ANY suggestion (not just the top one) and commit the FULL span behind it.
   */
  spans?: SpanOption[];
  /** preserved verbatim from our-own-export fast-path rows (lossless re-import). */
  preserved?: {
    railGeoVersion: string;
    source: string;
    tripId?: string;
    createdAt?: string;
  };
}

export interface ParseResult {
  report: ImportReport;
  /** parallel to report ordering; the full detail D2 + commit consume. */
  resolved: ResolvedRow[];
  /** true when the file was our own export (fast-path, no fuzzy matching). */
  reimport: boolean;
  /** populated when the file could not be parsed at all (no header / empty). */
  fatal?: string;
}

/**
 * CONTENT-derived batch id: re-parsing the identical CSV yields the identical
 * importBatchId, so the event ids built from it (commit.ts) are stable and a re-import
 * merges idempotently instead of doubling the log. (NOT random — that was the bug.)
 */
function batchIdFor(text: string): string {
  return `imp-${hashString(text)}`;
}

// ───────────────────────────── main parse ───────────────────────────────────

export function parseImport(
  text: string,
  pkg: RailGeoPackage | RailGeoPackage[],
  geo: GeoIndex,
): ParseResult {
  const pkgs = Array.isArray(pkg) ? pkg : [pkg];
  const grid = parseCsv(text);
  const importBatchId = batchIdFor(text);

  if (grid.length === 0) {
    return emptyResult(importBatchId, 'CSV が空です。');
  }
  const header = grid[0];
  const dataRows = grid.slice(1);
  if (dataRows.length === 0) {
    return emptyResult(importBatchId, '取り込める行がありません（ヘッダー行のみ）。');
  }

  // Fast-path: our own export round-trips with no fuzzy matching.
  if (isOurExport(header)) {
    return parseOurExport(header, dataRows, importBatchId, pkgs, geo);
  }

  const cols = detectColumns(header);
  // We need at least a way to name a station. A line column alone or no station-ish
  // column at all means we can't interpret the file as rides.
  if (!cols.has.has('span') && !cols.has.has('from') && !cols.has.has('station')) {
    return emptyResult(
      importBatchId,
      '駅・区間の列が見つかりませんでした。路線・駅（または区間）を含む CSV をご用意ください。',
    );
  }

  const resolved: ResolvedRow[] = [];
  dataRows.forEach((cells, i) => {
    resolved.push(resolveIncumbentRow(cells, cols, i, pkgs, geo));
  });

  return finalize(resolved, importBatchId, false);
}

function emptyResult(importBatchId: string, fatal: string): ParseResult {
  return {
    report: { total: 0, matched: 0, needsReview: [], importBatchId },
    resolved: [],
    reimport: false,
    fatal,
  };
}

// ───────────────────────────── incumbent row ────────────────────────────────

function cellAt(cells: string[], roleOf: ColumnMap['roleOf'], role: Exclude<ColRole, null>): string | undefined {
  const idx = roleOf.indexOf(role);
  if (idx === -1) return undefined;
  const v = cells[idx]?.trim();
  return v ? v : undefined;
}

function numAt(cells: string[], roleOf: ColumnMap['roleOf'], role: Exclude<ColRole, null>): number | undefined {
  const v = cellAt(cells, roleOf, role);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function resolveIncumbentRow(
  cells: string[],
  cols: ColumnMap,
  rawIndex: number,
  pkgs: RailGeoPackage[],
  geo: GeoIndex,
): ResolvedRow {
  const roleOf = cols.roleOf;
  const rawLineName = cellAt(cells, roleOf, 'line');
  const date = cellAt(cells, roleOf, 'date');
  const trainModel = cellAt(cells, roleOf, 'model');
  const lon = numAt(cells, roleOf, 'lon');
  const lat = numAt(cells, roleOf, 'lat');

  // Determine the two endpoints (from/to). Priority: explicit from+to, then a 区間 span,
  // then a single station cell (a point ride — counts as its own A=B, surfaced for review).
  let fromName = cellAt(cells, roleOf, 'from');
  let toName = cellAt(cells, roleOf, 'to');
  const spanCell = cellAt(cells, roleOf, 'span');
  if ((!fromName || !toName) && spanCell) {
    const span = splitSpan(spanCell);
    if (span) {
      fromName ??= span.from;
      toName ??= span.to;
    } else {
      // a 区間 cell with no separator is a single point
      fromName ??= spanCell;
    }
  }
  if (!fromName) fromName = cellAt(cells, roleOf, 'station');

  const rawName = [rawLineName, [fromName, toName].filter(Boolean).join('〜')]
    .filter(Boolean)
    .join(' ');

  const base: ParsedRideRow = {
    rawIndex,
    rawName: rawName || '(空の行)',
    rawLineName,
    date,
    lon,
    lat,
    matchStatus: 'unmatched',
  };

  if (!fromName) {
    // Nothing to resolve — keep the row, mark unmatched (honest, not dropped).
    return { row: base, segmentIds: [], date, trainModel };
  }

  const fromInput: CrosswalkInput = { rawName: fromName, rawLineName, lon, lat };
  const fromV = resolveStation(fromInput, geo);

  // A single-endpoint ride (no destination): we can't form a full leg, so it's
  // review-only. Each suggestion is the candidate station joined to its NEXT neighbour —
  // one real, committable inter-station segment — so confirming it lights a true segment.
  if (!toName) {
    return reviewFrom(base, fromV, pkgs, date, trainModel);
  }

  const toV = resolveStation({ rawName: toName, rawLineName }, geo);

  // Both endpoints must be confidently matched AND on the same line for a clean match.
  if (fromV.status === 'matched' && toV.status === 'matched') {
    const a = fromV.best.station;
    const b = toV.best.station;
    if (a.lineId === b.lineId) {
      const pkg = pkgForLine(a.lineId, pkgs);
      if (pkg) {
        try {
          const segs = segmentsBetween(a.lineId, a.stationId, b.stationId, pkg);
          if (segs.length > 0) {
            return {
              row: {
                ...base,
                matchStatus: 'matched',
                matchedSegmentId: segs[0], // contract carries one; full list is on ResolvedRow
              },
              segmentIds: segs,
              lineId: a.lineId,
              date,
              trainModel,
              // mirror the span under spans keyed by matchedSegmentId, so commit.ts has
              // ONE uniform lookup (matched + confirmed-review both resolve a full span).
              spans: [{ segmentId: segs[0], segmentIds: segs, lineId: a.lineId }],
            };
          }
        } catch {
          // fall through to review — a gap in the stitched line, surface it
        }
      }
    }
  }

  // Not a clean match → build review suggestions from the joint endpoint candidates.
  return reviewSpan(base, fromV, toV, pkgs, geo, date, trainModel);
}

function pkgForLine(lineId: string, pkgs: RailGeoPackage[]): RailGeoPackage | undefined {
  return pkgs.find((p) => p.lines.some((l) => l.lineId === lineId));
}

// Single-endpoint review row: suggest the candidate station joined to its NEXT neighbour
// on the line — one real inter-station segment the user can confirm (or skip). We never
// fabricate a span the data doesn't support.
function reviewFrom(
  base: ParsedRideRow,
  fromV: ReturnType<typeof resolveStation>,
  pkgs: RailGeoPackage[],
  date: string | undefined,
  trainModel: string | undefined,
): ResolvedRow {
  const cands = candidatesOf(fromV);
  const spans: SpanOption[] = [];
  const suggestions: { segmentId: string; label: string; confidence: number }[] = [];
  for (const c of cands.slice(0, 5)) {
    const seg = adjacentSegment(c.station.lineId, c.station.stationId, pkgs);
    if (!seg) continue;
    spans.push({ segmentId: seg.segmentId, segmentIds: [seg.segmentId], lineId: c.station.lineId });
    suggestions.push({
      segmentId: seg.segmentId,
      label: `${c.line.name}・${c.station.name}（隣駅まで）`,
      confidence: round3(c.confidence),
    });
  }
  return {
    row: {
      ...base,
      matchStatus: suggestions.length ? 'ambiguous' : 'unmatched',
      suggestions: suggestions.length ? suggestions : undefined,
    },
    segmentIds: spans[0]?.segmentIds ?? [],
    lineId: spans[0]?.lineId,
    spans,
    date,
    trainModel,
  };
}

/** The inter-station segment whose lower endpoint is this station (its forward neighbour). */
function adjacentSegment(
  lineId: string,
  stationId: string,
  pkgs: RailGeoPackage[],
): { segmentId: string } | undefined {
  const pkg = pkgForLine(lineId, pkgs);
  if (!pkg) return undefined;
  // prefer the segment leaving this station; fall back to one arriving at it.
  const out = pkg.segments.find((s) => s.lineId === lineId && s.fromStationId === stationId);
  if (out) return { segmentId: out.segmentId };
  const inb = pkg.segments.find((s) => s.lineId === lineId && s.toStationId === stationId);
  return inb ? { segmentId: inb.segmentId } : undefined;
}

// A〜B review row. We enumerate plausible (fromLine, toLine) pairs that land on the SAME
// line and produce a real expandable span, ranked by combined endpoint confidence — those
// are the actionable suggestions for D2. Each suggestion's segmentId is the FIRST segment
// of the span (the commit re-expands the full span from the chosen endpoints).
function reviewSpan(
  base: ParsedRideRow,
  fromV: ReturnType<typeof resolveStation>,
  toV: ReturnType<typeof resolveStation>,
  pkgs: RailGeoPackage[],
  geo: GeoIndex,
  date: string | undefined,
  trainModel: string | undefined,
): ResolvedRow {
  const fromCands = candidatesOf(fromV);
  const toCands = candidatesOf(toV);

  interface Suggestion {
    segmentId: string;
    label: string;
    confidence: number;
    segmentIds: string[];
    lineId: string;
  }
  const suggestions: Suggestion[] = [];
  const seenLine = new Set<string>();
  for (const fc of fromCands) {
    for (const tc of toCands) {
      if (fc.station.lineId !== tc.station.lineId) continue;
      const lineId = fc.station.lineId;
      const pkg = pkgForLine(lineId, pkgs);
      if (!pkg) continue;
      let segs: string[] = [];
      try {
        segs = segmentsBetween(lineId, fc.station.stationId, tc.station.stationId, pkg);
      } catch {
        continue;
      }
      if (segs.length === 0) continue;
      const key = `${lineId}:${segs[0]}:${segs[segs.length - 1]}`;
      if (seenLine.has(key)) continue;
      seenLine.add(key);
      const line = geo.lineById.get(lineId);
      suggestions.push({
        segmentId: segs[0],
        label: `${line?.name ?? lineId}・${fc.station.name}〜${tc.station.name}（${segs.length}区間）`,
        confidence: round3((fc.confidence + tc.confidence) / 2),
        segmentIds: segs,
        lineId,
      });
    }
  }
  suggestions.sort((a, b) => b.confidence - a.confidence);
  const top = suggestions.slice(0, 5);

  return {
    row: {
      ...base,
      matchStatus: top.length ? 'ambiguous' : 'unmatched',
      suggestions: top.length
        ? top.map((s) => ({ segmentId: s.segmentId, label: s.label, confidence: s.confidence }))
        : undefined,
    },
    segmentIds: top[0]?.segmentIds ?? [],
    lineId: top[0]?.lineId,
    date,
    trainModel,
    // Every suggestion's full expansion, so D2 can confirm ANY of them by its segmentId
    // and commit.ts re-expands the whole span behind it.
    spans: top.map((s) => ({ segmentId: s.segmentId, segmentIds: s.segmentIds, lineId: s.lineId })),
  };
}

function candidatesOf(v: ReturnType<typeof resolveStation>) {
  if (v.status === 'matched') return [v.best];
  return v.candidates;
}

// ───────────────────────────── our-own-export path ──────────────────────────

function parseOurExport(
  header: string[],
  dataRows: string[][],
  importBatchId: string,
  pkgs: RailGeoPackage[],
  geo: GeoIndex,
): ParseResult {
  const idx = (name: string): number => header.findIndex((h) => h.trim() === name);
  const iSeg = idx('segmentId');
  const iVer = idx('railGeoVersion');
  const iSource = idx('source');
  const iTrip = idx('tripId');
  const iCreated = idx('createdAt');
  const iDate = idx('date');
  const iModel = idx('trainModel');

  const knownSeg = new Set<string>();
  for (const p of pkgs) for (const s of p.segments) knownSeg.add(s.segmentId);

  const resolved: ResolvedRow[] = dataRows.map((cells, rawIndex) => {
    const segmentId = (cells[iSeg] ?? '').trim();
    const railGeoVersion = (cells[iVer] ?? '').trim();
    const source = (cells[iSource] ?? 'import').trim();
    const tripId = (cells[iTrip] ?? '').trim() || undefined;
    const createdAt = (cells[iCreated] ?? '').trim() || undefined;
    const date = (cells[iDate] ?? '').trim() || undefined;
    const trainModel = (cells[iModel] ?? '').trim() || undefined;

    // A re-imported segment is "matched" iff it exists in a loaded package.
    const ok = segmentId.length > 0 && knownSeg.has(segmentId);
    const seg = pkgs.flatMap((p) => p.segments).find((s) => s.segmentId === segmentId);
    const label = seg
      ? `${geo.lineById.get(seg.lineId)?.name ?? seg.lineId}（${segmentId}）`
      : segmentId || '(空)';

    return {
      row: {
        rawIndex,
        rawName: label,
        rawLineName: seg ? geo.lineById.get(seg.lineId)?.name : undefined,
        date,
        matchStatus: (ok ? 'matched' : 'unmatched') as MatchStatus,
        matchedSegmentId: ok ? segmentId : undefined,
        suggestions: ok ? undefined : [],
      },
      segmentIds: ok ? [segmentId] : [],
      lineId: seg?.lineId,
      date,
      trainModel,
      preserved: {
        railGeoVersion: railGeoVersion || (pkgs[0]?.version ?? ''),
        source,
        tripId,
        createdAt,
      },
    };
  });

  return finalize(resolved, importBatchId, true);
}

// ───────────────────────────── finalize ─────────────────────────────────────

function finalize(resolved: ResolvedRow[], importBatchId: string, reimport: boolean): ParseResult {
  const matched = resolved.filter((r) => r.row.matchStatus === 'matched').length;
  const needsReview = resolved.filter((r) => r.row.matchStatus !== 'matched').map((r) => r.row);
  return {
    report: { total: resolved.length, matched, needsReview, importBatchId },
    resolved,
    reimport,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
