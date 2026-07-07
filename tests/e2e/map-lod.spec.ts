import { test, expect, type Page } from '@playwright/test';

// Zoom-tiered LOD, finally under test in a real headless WebGL context.
//
// Each line carries a reveal zoom `minz` derived from its rank (RANK_MINZOOM = [3,4,5,6,7]).
// The SEGMENTS_LAYER ('rp-segments-line') filter is `zoom >= minz OR ridden OR selected`, so:
//   • rank 0 (Shinkansen) minz 3, rank 1 (trunk) minz 4  → visible at the national z4 view
//   • rank 2 (山手線, subways) minz 5+                     → hidden at z4 UNLESS ridden
// We seed a ridden 山手線 (rank 2, minz 5) and assert both directions: at z4 nothing below the
// tier leaks except the ridden line; zooming into Tokyo reveals the urban tiers.

const VERSION = '2025.2.0';
const RIDDEN_YAMANOTE = [
  'jp-東日本旅客鉄道-山手線:004095-004135',
  'jp-東日本旅客鉄道-山手線:004135-004110',
  'jp-東日本旅客鉄道-山手線:004110-004072',
];

type RenderedSeg = { segmentId: string; minz: number };

// The DB name 'railprint', the store 'rideEvents', and the record shape below mirror
// src/lib/db.ts (the source of truth). Dexie/db.ts can't run inside page.evaluate, so a
// schema rename there must be mirrored here by hand — there's no compile-time link.
/** Write ride events straight into the app's IndexedDB ('railprint' → 'rideEvents' store). */
async function seedRides(page: Page): Promise<void> {
  await page.evaluate(
    async ({ ids, version }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('railprint');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('rideEvents', 'readwrite');
          for (const segmentId of ids) {
            tx.objectStore('rideEvents').put({
              id: crypto.randomUUID(),
              segmentId,
              railGeoVersion: version,
              source: 'manual',
              createdAt: new Date().toISOString(),
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      });
    },
    { ids: RIDDEN_YAMANOTE, version: VERSION },
  );
}

/** Drive the live map to a fixed center/zoom, wait for it to settle, return rendered segments. */
async function renderedSegments(
  page: Page,
  center: [number, number],
  zoom: number,
): Promise<RenderedSeg[]> {
  return page.evaluate(
    async ({ center, zoom }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__map;
      // jumpTo is instantaneous → 'moveend' fires right away; then let the GeoJSON rail layers
      // repaint for the new viewport over a few frames before querying. ('idle' is unusable
      // here — the offline basemap keeps the map perpetually non-idle.)
      await new Promise<void>((res) => {
        map.once('moveend', () => {
          let frames = 0;
          const tick = (): void => {
            if (++frames >= 4) res();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        map.jumpTo({ center, zoom });
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return map.queryRenderedFeatures({ layers: ['rp-segments-line'] }).map((f: any) => ({
        segmentId: f.properties.segmentId as string,
        minz: Number(f.properties.minz),
      }));
    },
    { center, zoom },
  );
}

test('zoom-LOD: low zoom shows only top tiers + ridden; zooming in reveals urban lines', async ({
  page,
}) => {
  // The first load creates the (empty) IndexedDB and shows the empty state; seed, then reload
  // so the app boots WITH rides (and the map mounts instead of the "地図に灯そう" overlay).
  await page.goto('/?e2e=1');
  await page.waitForFunction(
    async () => (await indexedDB.databases()).some((d) => d.name === 'railprint'),
    null,
    { timeout: 20_000 },
  );
  await seedRides(page);
  await page.reload();
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__mapReady === true,
    null,
    { timeout: 30_000 },
  );

  const ridden = new Set(RIDDEN_YAMANOTE);

  // ── z4 over all Japan: the tier filter hides every line with minz > 4 unless it's ridden.
  const atZ4 = await renderedSegments(page, [138, 38], 4);
  expect(atZ4.length).toBeGreaterThan(0);

  // No NON-ridden segment above the z4 tier may render (proves tier hiding).
  const leaked = atZ4.filter((f) => f.minz > 4 && !ridden.has(f.segmentId));
  expect(leaked, `below-tier lines leaked at z4: ${leaked.slice(0, 5).map((f) => f.segmentId).join(', ')}`).toEqual([]);

  // The ridden 山手線 (minz 5, below the z4 tier) IS visible (proves ridden-always-on).
  expect(atZ4.some((f) => ridden.has(f.segmentId))).toBe(true);

  // At least one genuine top-tier line (Shinkansen/trunk, minz <= 4) is on the national view.
  expect(atZ4.some((f) => f.minz <= 4)).toBe(true);

  // ── z7 over Tokyo: the lower tiers reveal. A NON-ridden urban line (minz > 4) must appear.
  const atZ7 = await renderedSegments(page, [139.7, 35.69], 7);
  const revealed = atZ7.filter((f) => f.minz > 4 && f.minz <= 7 && !ridden.has(f.segmentId));
  expect(revealed.length, 'no urban (minz>4) lines revealed by zooming to Tokyo z7').toBeGreaterThan(0);
});

test('the QA hook stays off without ?e2e — no window.__map ships to real users', async ({ page }) => {
  // Boot WITHOUT the e2e flag, but seed a ride so the map actually mounts (same code path that
  // would expose the handle if it weren't gated). The handle must never appear.
  await page.goto('/');
  await page.waitForFunction(
    async () => (await indexedDB.databases()).some((d) => d.name === 'railprint'),
    null,
    { timeout: 20_000 },
  );
  await seedRides(page);
  await page.reload();
  // Wait for the map canvas to attach — exposeE2EHandle() runs right after the map is created, so
  // if the gate leaked, window.__map would be set by the time the canvas exists. (state:'attached'
  // because the canvas is in the DOM before maplibre lays it out to a visible size.)
  await page.waitForSelector('.maplibregl-canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(1500);
  const exposed = await page.evaluate(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map: (window as any).__map !== undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ready: (window as any).__mapReady !== undefined,
  }));
  expect(exposed.map, 'window.__map must NOT exist without ?e2e').toBe(false);
  expect(exposed.ready, 'window.__mapReady must NOT exist without ?e2e').toBe(false);
});
