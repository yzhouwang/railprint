// QA hook (E2E only) — extracted from MapView so the map component stays about the map.
//
// Headless `$B` browse has no WebGL and CDP can't drive zoom, so the zoom-tiered LOD is otherwise
// un-QA-able. When the page is opened with ?e2e=1 we expose the live maplibre map + a ready flag on
// `window` so a Playwright/SwiftShader run can call setZoom + queryRenderedFeatures and assert which
// line tiers are visible. The hook ships in the bundle but stays inert without ?e2e, so a normal
// user never receives the handle. See tests/e2e/map-lod.spec.ts.
//
// The window contract (`__map` / `__mapReady`) is depended on by every e2e spec — do NOT rename it.

import type { Map as MapLibreMap } from 'maplibre-gl';

interface E2EWindow {
  __map?: unknown;
  __mapReady?: boolean;
}

const E2E_READY_POLL_MS = 100;
const E2E_READY_MAX_TICKS = 100; // ≤10s — bounded so the poll can't spin forever
let e2eReadyTimer: ReturnType<typeof setTimeout> | null = null;

/** True only when the page was opened with ?e2e — gates the whole hook. */
export function e2eEnabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('e2e');
}

/**
 * Publish the live map on `window.__map` and poll `map.loaded()` → `window.__mapReady`. No-op
 * without ?e2e. Readiness polls `map.loaded()` rather than the 'load'/'idle' events: under a flaky
 * or offline basemap (e.g. CI with no internet) the raster source retries forever so those events
 * never fire, but `loaded()` still flips true once the local rail layers are rendered and queryable
 * — which is all the LOD assertions need. Bounded + cancellable: if `loaded()` never settles within
 * the cap we stop and leave `__mapReady` false so the test's readiness wait fails loudly instead of
 * the poll spinning against a dead map.
 */
export function exposeE2EHandle(map: MapLibreMap): void {
  if (!e2eEnabled()) return;
  // Cancel any poll chain still running from a prior mount/HMR before starting a new one, so an
  // earlier chain can't keep ticking against a stale map.
  if (e2eReadyTimer !== null) {
    clearTimeout(e2eReadyTimer);
    e2eReadyTimer = null;
  }
  const w = window as unknown as E2EWindow;
  w.__map = map;
  w.__mapReady = false;
  let ticks = 0;
  const markReady = (): void => {
    if (map.loaded()) {
      w.__mapReady = true;
      e2eReadyTimer = null;
      return;
    }
    if (++ticks >= E2E_READY_MAX_TICKS) {
      e2eReadyTimer = null;
      return;
    }
    e2eReadyTimer = setTimeout(markReady, E2E_READY_POLL_MS);
  };
  markReady();
}

/** Tear down the hook: cancel the poll + remove the window globals. */
export function clearE2EHandle(): void {
  if (typeof window === 'undefined') return;
  if (e2eReadyTimer !== null) {
    clearTimeout(e2eReadyTimer);
    e2eReadyTimer = null;
  }
  const w = window as unknown as E2EWindow;
  delete w.__map;
  delete w.__mapReady;
}
