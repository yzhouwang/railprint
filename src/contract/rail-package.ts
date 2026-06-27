// ─────────────────────────────────────────────────────────────────────────────
// THE RAILNET DATA CONTRACT — the shared shape of a rail-geo package.
//
// OWNED BY railnet (the standalone rail-geo data package). This file is the single
// producer↔consumer boundary: railnet's build emits artifacts that satisfy these
// types; RailPrint consumes them. It is SYNCED from railnet (scripts/sync-railnet.mjs)
// and pinned by `railnet.json` — do not hand-edit the app's copy; edit it in railnet
// and re-sync. Kept dependency-free (only the global GeoJSON types) so railnet can
// own it with zero app coupling.
//
// Schema versions are EXPLICIT so a producer/consumer skew fails loudly instead of
// silently mis-resolving a returning user's saved coverage:
//  • PACKAGE_SCHEMA_VERSION  — the RailGeoPackage payload shape
//  • MANIFEST_SCHEMA_VERSION — the manifest.json integrity-manifest shape
// ─────────────────────────────────────────────────────────────────────────────

export type Country = 'JP' | 'CN';

/** Bump when the RailGeoPackage payload shape changes incompatibly. */
export const PACKAGE_SCHEMA_VERSION = 1;
/** The manifest.json `schemaVersion` the consumer understands. Bump on an incompatible manifest change. */
export const MANIFEST_SCHEMA_VERSION = 2;

/** Canonical MLIT N02 attribution — the SINGLE source for both railnet's build and the app's map
 *  credit control, so the two can never drift (they did before this contract existed). */
export const RAIL_ATTRIBUTION_JP =
  '鉄道データ: 国土数値情報（鉄道データ N02）2025年度版（国土交通省）を加工して作成（CC BY 4.0）';

// ───────────────────────────── RAIL-GEO PACKAGE ─────────────────────────────
// A frozen, versioned, deterministic artifact. crs is ALWAYS WGS84, never GCJ-02.

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
  operator?: string;     // operating company (N02_004 formal name, e.g. 東日本旅客鉄道); shown as a muted label.
  nameRoma?: string;     // romaji line name (山手線 → "Yamanote Line"); OSM/Wikidata-sourced
  color?: string;        // official line color (hex); ALWAYS set — sourced or operator-default
  logo?: string;         // path under /rail/logos/ to the line's logo, only when sourced
  rank?: 0 | 1 | 2 | 3 | 4; // map LOD tier: 0 Shinkansen … 4 minor. Drives per-segment minz (zoom reveal).
  country: Country;
  isHSR: boolean;        // JP: keyed off 事業者種別 N02_002==1
  isLoop: boolean;
  stationOrder: string[]; // ordered stationIds along the stitched line
  geometry: GeoJSON.LineString; // stitched, ordered, direction-consistent, WGS84
}

// The coverage PRIMITIVE: one inter-station segment with precomputed km.
export interface RailSegment {
  // canonical id = `${lineId}:${discriminator}`, a BUILD-STABLE key for the inter-station segment.
  //  • JP (v2 scheme): the endpoints' raw N02_005g group codes `${fromGroup}-${toGroup}` —
  //    content-addressed, stable across data refreshes (revisit lines: `${fromGroup}@${k}-${toGroup}@${k}`).
  //  • Generic/CN builds still emit positional `${fromSeq}-${toSeq}` until a per-namespace station
  //    identity scheme lands (CN has no group codes yet — deferred to E2 broad-China).
  // positional fromSeq/toSeq stay on the struct as metadata regardless.
  segmentId: string;
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
  //                        so transfer stations share one reading. ~97% coverage.
  romaSource?: 'osm' | 'wikidata' | 'manual'; // provenance for ODbL attribution + accuracy audit
  lineId: string;
  seq: number;
  lon: number;
  lat: number;
  // The cross-line station-group code (N02_005g): SHARED by the same physical station
  // across lines (新宿 on 7 lines → same stationGroupId, different stationId). Optional;
  // present for N02-sourced packages.
  stationGroupId?: string;
}

// ─────────────────────────── INTEGRITY MANIFEST ─────────────────────────────
// railnet emits rail/manifest.json; the app loads packages through it (path + version +
// per-file SHA-256). Typed HERE (was previously hand-duplicated in the producer and the
// consumer with the schema version hardcoded in both — a silent-skew trap).

export interface RailMigrationStep {
  fromVersion: string;
  toVersion: string;
  path: string;          // relative to the rail root, e.g. rail/migrations/jp/2025.1.0-to-2025.2.0.json
  sha256?: string;
}

export interface RailManifestPackage {
  version: string;
  path: string;          // relative, e.g. rail/jp-2025.json
  sha256?: string;
  migrations: RailMigrationStep[];
}

export interface RailManifest {
  schemaVersion?: number;   // MANIFEST_SCHEMA_VERSION; the consumer rejects an unknown major
  generatedAt?: string;
  packages: Record<string, RailManifestPackage>;
}
