// The vector basemap under the rail layers — OpenFreeMap's `positron` (keyless, no usage caps,
// muted light-grey: designed as a data-overlay background, which is exactly the JR-East aesthetic
// the old muted-raster hack approximated). The style JSON is VENDORED at public/basemap/positron.json
// (same-origin → service-worker precached), so boot never fetches a third-party style; only the
// tiles/glyphs/sprite come from tiles.openfreemap.org at runtime (SW runtime-cached). Replaces the
// tile.openstreetmap.org raster — OSMF's tile usage policy prohibits public apps on osm.org tiles.
//
// Offline / fetch-failure ⇒ null: buildBaseStyle then renders rail over a plain background, the
// same graceful degradation the raster had (the map-lod harness polls map.loaded(), which settles
// even when every basemap source fails).

/** The subset of a MapLibre style a merge needs. Kept loose — style.ts deliberately owns no maplibre types. */
export interface ExternalBasemap {
  sources: Record<string, Record<string, unknown>>;
  layers: object[];
  glyphs?: string;
  sprite?: string;
}

/** OSM attribution is REQUIRED (the data under OpenMapTiles/OpenFreeMap is OSM); the vendored
 *  style JSON carries none, so the loader stamps it onto every basemap source. */
export const BASEMAP_ATTRIBUTION = '© OpenStreetMap contributors｜OpenFreeMap';

const LOAD_TIMEOUT_MS = 8000;

/**
 * Load the vendored basemap style (same-origin, precached after first visit). Returns null on any
 * failure — timeout, offline, bad JSON, unexpected shape — the map then boots basemap-less.
 */
export async function loadBasemap(): Promise<ExternalBasemap | null> {
  // Offline ⇒ basemap-less on purpose. The style JSON is PRECACHED, so offline it would load
  // fine — and then every tiles.openfreemap.org fetch inside it fails, spraying pre-ready map
  // 'error' events. Skipping here keeps the offline boot on the clean plain-background path.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl && typeof window !== 'undefined' ? window.setTimeout(() => ctl.abort(), LOAD_TIMEOUT_MS) : null;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}basemap/positron.json`, ctl ? { signal: ctl.signal } : undefined);
    if (!res.ok) return null;
    return normalizeBasemap(await res.json());
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** Validate the minimal shape + stamp the required attribution. Exported for tests. */
export function normalizeBasemap(raw: unknown): ExternalBasemap | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const style = raw as Record<string, unknown>;
  const sources = style.sources;
  const layers = style.layers;
  if (typeof sources !== 'object' || sources === null || !Array.isArray(layers)) return null;
  const stamped: Record<string, Record<string, unknown>> = {};
  for (const [id, src] of Object.entries(sources as Record<string, Record<string, unknown>>)) {
    stamped[id] = { ...src, attribution: (src.attribution as string) || BASEMAP_ATTRIBUTION };
  }
  return {
    sources: stamped,
    layers: layers as object[],
    ...(typeof style.glyphs === 'string' ? { glyphs: style.glyphs } : {}),
    ...(typeof style.sprite === 'string' ? { sprite: style.sprite } : {}),
  };
}
