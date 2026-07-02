// The geo index: pure lookup maps derived from the loaded RailGeoPackage(s). This is framework-free
// on purpose — the reactive `geo` store (store.ts) derives from buildGeoIndex, and pure modules
// (search, map/popup, export, wrapped/card) index geometry through here WITHOUT importing the
// stateful store (which owns fetch + Dexie + the fallback machinery). store.ts re-exports these so
// existing importers keep working; there is ONE indexer, no drift.

import type { Country, RailGeoPackage, RailLine, RailSegment, RailStation } from '../contract/types';

/** One physical-station instance on a particular line (a transfer station has many). */
export interface StationGroupMember {
  lineId: string;
  stationId: string;
}

export interface GeoIndex {
  lineById: Map<string, RailLine>;
  stationById: Map<string, RailStation>;
  segmentById: Map<string, RailSegment>;
  linesByCountry: Map<Country, RailLine[]>;
  stationsByLine: Map<string, RailStation[]>;
  /**
   * The cross-line station group (N02_005g) → every (line, station) instance that shares it.
   * 新宿 on 7 lines collapses to ONE group with 7 members; line inference (search.ts) intersects
   * two stations' groups across the lines they appear on. Stations lacking a stationGroupId fall
   * back to a synthetic per-station group keyed `solo:<stationId>` so inference still works 1:1.
   */
  stationGroupById: Map<string, StationGroupMember[]>;
}

/** The group key for a station: its cross-line stationGroupId, or a synthetic solo key. */
export function groupKeyOf(station: RailStation): string {
  return station.stationGroupId ?? `solo:${station.stationId}`;
}

/**
 * Pure builder for the geo index over a set of packages. The reactive `geo` store derives
 * from this; tests reuse it directly (no Svelte subscription) so there is ONE indexer, no drift.
 */
export function buildGeoIndex(pkgs: RailGeoPackage[]): GeoIndex {
  const lineById = new Map<string, RailLine>();
  const stationById = new Map<string, RailStation>();
  const segmentById = new Map<string, RailSegment>();
  const linesByCountry = new Map<Country, RailLine[]>();
  const stationsByLine = new Map<string, RailStation[]>();
  const stationGroupById = new Map<string, StationGroupMember[]>();
  for (const pkg of pkgs) {
    for (const l of pkg.lines) {
      lineById.set(l.lineId, l);
      (linesByCountry.get(pkg.country) ?? linesByCountry.set(pkg.country, []).get(pkg.country)!).push(l);
    }
    for (const s of pkg.stations) {
      stationById.set(s.stationId, s);
      (stationsByLine.get(s.lineId) ?? stationsByLine.set(s.lineId, []).get(s.lineId)!).push(s);
      const gk = groupKeyOf(s);
      (stationGroupById.get(gk) ?? stationGroupById.set(gk, []).get(gk)!).push({
        lineId: s.lineId,
        stationId: s.stationId,
      });
    }
    for (const seg of pkg.segments) segmentById.set(seg.segmentId, seg);
  }
  for (const list of stationsByLine.values()) list.sort((a, b) => a.seq - b.seq);
  return { lineById, stationById, segmentById, linesByCountry, stationsByLine, stationGroupById };
}
