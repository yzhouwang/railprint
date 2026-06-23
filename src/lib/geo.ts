// Point-to-point distance only. This is NOT the coverage engine.
//
// HARD RULE (CLAUDE_PLAN, ORCHESTRATION): the app re-derives ZERO rail geometry at
// runtime. Coverage km is precomputed at build time (turf, engine lane) and lives on
// `RailSegment.km`; the resolver only *sums* those. The two legitimate uses of a
// haversine here are (a) building the *stub* RailGeoPackage fixture before the engine's
// real package lands, and (b) the importer's coordinate-proximity tie-breaker when
// fuzzy-matching a raw station name to a station point. Neither measures the network.

const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two lon/lat points, in kilometres. */
export function haversineKm(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
