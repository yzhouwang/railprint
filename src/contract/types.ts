// RailPrint shared contract — OWNED BY THE STEERING-CONTROL SESSION.
// Two lanes: ENGINE = GPT-5.5 via codex CLI (geometry pipeline + tests);
// EXPERIENCE = Opus 4.8 via claude (app kernel + importer + all UI).
// The ONLY cross-lane artifact is RailGeoPackage: GPT-5.5 produces it, Opus 4.8
// consumes it. Everything else below is Opus 4.8's, kept here for one shared shape.
// NEITHER lane mutates this file. A change requires a steering-control bump.
// See docs/agents/ORCHESTRATION.md.

export type Country = 'JP' | 'CN';

// ───────────────────────────── RAIL-GEO PACKAGE ─────────────────────────────
// Produced by GPT-5.5/engine (T2 stitch, T3 Shinkansen, T9 China corridor) as a
// frozen, versioned artifact. Consumed by Opus 4.8 (T5 resolver + T6 map). This is
// the single cross-lane boundary; T7 golden tests (engine) gate it on drift.
export interface RailGeoPackage {
  version: string;       // semver, pinned in every RideEvent
  generatedAt: string;   // ISO 8601
  crs: 'WGS84';          // always — never GCJ-02
  country: Country;
  lines: RailLine[];
  segments: RailSegment[];
  stations: RailStation[];
}

export interface RailLine {
  lineId: string;
  name: string;
  nameRoma?: string;     // romaji line name (山手線 → "Yamanote Line"); OSM/Wikidata-sourced [steering bump]
  color?: string;        // official line color (hex); ALWAYS set — sourced or operator-default [steering bump]
  logo?: string;         // path under /rail/logos/ to the line's logo, only when sourced [steering bump]
  country: Country;
  isHSR: boolean;        // JP: keyed off 事業者種別 N02_002==1
  isLoop: boolean;
  stationOrder: string[]; // ordered stationIds along the stitched line
  geometry: GeoJSON.LineString; // stitched, ordered, direction-consistent, WGS84
}

// The coverage PRIMITIVE: one inter-station segment with precomputed km.
export interface RailSegment {
  segmentId: string;     // canonical id, MUST be `${lineId}:${fromSeq}-${toSeq}`
  lineId: string;
  fromStationId: string;
  toStationId: string;
  fromSeq: number;
  toSeq: number;
  km: number;            // precomputed at BUILD time (turf), runtime only sums
  isHSR: boolean;
  arcDirection?: 'cw' | 'ccw'; // REQUIRED for loop lines (two arcs between A,B)
  geometry: GeoJSON.LineString;
}

export interface RailStation {
  stationId: string;     // UNIQUE per (line, station). For N02: `${lineId}:${N02_005g}`.
  name: string;
  nameRoma?: string;     // romaji reading (新宿 → "Shinjuku"); keyed by stationGroupId at build time,
  //                        so transfer stations share one reading. ~97% coverage. [steering bump]
  romaSource?: 'osm' | 'wikidata' | 'manual'; // provenance for ODbL attribution + accuracy audit
  lineId: string;
  seq: number;
  lon: number;
  lat: number;
  // The cross-line station-group code (N02_005g): SHARED by the same physical station
  // across lines (新宿 on 7 lines → same stationGroupId, different stationId). Optional;
  // present for N02-sourced packages. Enables future transfer detection without colliding
  // stationId (which MUST stay line-unique, or geo.stationById collapses). [steering bump]
  stationGroupId?: string;
}

// ─────────────────────────── COVERAGE + RIDE EVENTS ──────────────────────────
// Opus 4.8 (T5) owns the Dexie store + resolver. The store reads the geometry
// ONLY through the RailGeoPackage artifact — never re-derives geometry.
export type RideSource = 'manual' | 'import' | 'corridor';

export interface RideEvent {
  id: string;            // uuid
  segmentId: string;
  railGeoVersion: string; // pin — resolver warns/migrates on mismatch
  date?: string;         // ISO date; OPTIONAL (undated imports still count to coverage)
  trainModel?: string;
  source: RideSource;
  tripId?: string;       // Claude T11 groups legs into a trip
  importBatchId?: string;
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
