// RailPrint shared contract — OWNED BY THE STEERING-CONTROL SESSION.
// Two lanes: ENGINE = GPT-5.5 via codex CLI (geometry pipeline + tests);
// EXPERIENCE = Opus 4.8 via claude (app kernel + importer + all UI).
// The ONLY cross-lane artifact is RailGeoPackage: GPT-5.5 produces it, Opus 4.8
// consumes it. Everything else below is Opus 4.8's, kept here for one shared shape.
// NEITHER lane mutates this file. A change requires a steering-control bump.
// See docs/agents/ORCHESTRATION.md.

// ───────────────────────── THE RAILNET DATA CONTRACT ────────────────────────
// The rail-geo data shape now lives in ./rail-package — OWNED BY railnet (the standalone
// rail-geo data package), synced into the app + pinned via railnet.json. Re-exported here
// so the existing ~30 `from '../contract/types'` import sites keep working unchanged. A
// change to the data shape happens in railnet, not here. (RailManifest typing the integrity
// manifest + the schema-version constants close the old producer/consumer silent-skew trap.)
import type { RailGeoPackage } from './rail-package';
export type {
  Country,
  RailGeoPackage,
  RailLine,
  RailSegment,
  RailStation,
  RailManifest,
  RailManifestPackage,
  RailMigrationStep,
} from './rail-package';
export { PACKAGE_SCHEMA_VERSION, MANIFEST_SCHEMA_VERSION, RAIL_ATTRIBUTION_JP } from './rail-package';

// ─────────────────────────── COVERAGE + RIDE EVENTS ──────────────────────────
// Opus 4.8 (T5) owns the Dexie store + resolver. The store reads the geometry
// ONLY through the RailGeoPackage artifact — never re-derives geometry.
export type RideSource = 'manual' | 'import' | 'corridor';

export interface RideEvent {
  id: string;            // uuid (kept STABLE across a geo-version migration — coverage keys on segmentId, not id)
  segmentId: string;     // remapped in place by a railGeoVersion migration; coverage derives from THIS
  originalSegmentId?: string; // the FIRST-EVER segmentId, set once on the first migration — reversibility audit
  railGeoVersion: string; // pin — bumped to the package version once an N→N+1 migration remaps this event
  // Phase 4 quarantine steering bump: snapshot km at record time so an abolished segment can
  // remain visible as closed-line history even after the segment leaves the loaded package.
  km?: number;
  date?: string;         // ISO date; OPTIONAL (undated imports still count to coverage)
  trainModel?: string;
  source: RideSource;
  tripId?: string;       // Claude T11 groups legs into a trip
  importBatchId?: string;
  quarantine?: 'kept';   // Phase 4: user kept an orphan as closed-line history; absent = active/pending
  createdAt: string;     // ISO
}

// Coverage TRUTH (drives %) is the SET of ridden segmentIds — derived from events,
// dupe/undated-proof. Stats (drive the Wrapped card) come from events.
export interface CoverageResult {
  riddenKm: number;
  totalKm: number;
  pctNational: number;   // 0..100, rounded by the UI for display
  hsrRiddenKm: number;
  hsrTotalKm: number;
  pctHSR: number;
  litSegmentIds: string[]; // map style expression keys off these
  prefectures: number;
  longestRide?: { fromStationId: string; toStationId: string; km: number };
  mostRiddenLineId?: string;
  fastestTrainModel?: string;
}

// The SINGLE boundary the UI calls. Pure, deterministic (Opus 4.8, T5).
export type ResolveCoverage = (events: RideEvent[], pkg: RailGeoPackage) => CoverageResult;
// Marking helper (line-first): returns the segmentIds between two stations on one line.
export type SegmentsBetween = (
  lineId: string, fromStationId: string, toStationId: string, pkg: RailGeoPackage
) => string[]; // throws if stations are not on the same line

// Cross-line route-finding (search-mode). A candidate path A→B across one or more lines, found by
// Yen k-shortest over the segment + transfer graph (src/lib/route.ts, engine lane). The route-picker
// renders these; marking lights the chosen route's segments under one trip. [steering bump]
export interface RouteCandidate {
  segmentIds: string[];   // segments to light, in travel order A→B
  lines: string[];        // distinct lineIds traversed, in order (length 1 = single-line, 0-change route)
  totalKm: number;
  lineChanges: number;    // line-id switches along the path — NOT "transfers" (a through-train is one seat)
  railGeoVersion: string; // pinned from the (single) package the route was found in
}
// Engine-lane route-finder. Pure, deterministic; internally memoizes the graph by package identity.
// Returns up to k candidates ranked (lineChanges asc, then totalKm asc); every single-line (0-change)
// route is preserved (never dropped by the k cap). [] when A==B or no path exists.
export type FindRoutes = (
  pkg: RailGeoPackage, fromGroupKey: string, toGroupKey: string, k?: number
) => RouteCandidate[];

// ───────────────────────────────── IMPORT ───────────────────────────────────
// Importer (Opus 4.8, T4) and the D2 review-and-resolve screen are BOTH Opus 4.8;
// these types are intra-lane but kept here so the engine's golden tests can assert them.
export type MatchStatus = 'matched' | 'ambiguous' | 'unmatched';

export interface ParsedRideRow {
  rawIndex: number;
  rawName: string;          // raw station/segment text from the incumbent export
  rawLineName?: string;
  date?: string;
  lon?: number;
  lat?: number;
  matchStatus: MatchStatus;
  matchedSegmentId?: string; // set when matchStatus === 'matched'
  suggestions?: { segmentId: string; label: string; confidence: number }[]; // ambiguous/unmatched
}

export interface ImportReport {
  total: number;
  matched: number;
  needsReview: ParsedRideRow[]; // ambiguous + unmatched — Claude D2 renders these
  importBatchId: string;
}

// D2 returns the user's decisions; T4 commits chosen rows as RideEvents (both Opus 4.8).
export interface ImportResolution {
  importBatchId: string;
  confirmed: { rawIndex: number; segmentId: string }[];
  skipped: number[]; // rawIndex values the user skipped
}

// ───────────────────────────── EXPORT CSV SCHEMA ─────────────────────────────
// T10 export ↔ T4 re-import (both Opus 4.8). MUST round-trip LOSSLESSLY.
// Exact column order — both lanes code to this string:
export const EXPORT_CSV_COLUMNS =
  'segmentId,lineId,railGeoVersion,rode,source,tripId,createdAt,date,trainModel' as const;
// One row per RideEvent. Re-import maps directly to RideEvent (no fuzzy matching).
