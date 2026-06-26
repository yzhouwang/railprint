import { test, expect, type Page } from '@playwright/test';

// Phase 2 — OFFLINE. The whole promise of an offline-first ride tracker is: mark a ride with no
// signal. This proves the Workbox service worker delivers it end-to-end — after ONE online load the
// app boots with the network fully cut, and the seeded 山手線 ride resolves against the REAL package
// (not the JP-only stub), which can only happen if the 8.8 MB package + manifest came from the SW
// cache. Without the SW this reload is a browser "no internet" page; that's the regression it guards.

const VERSION = '2025.2.0';
const RIDDEN_YAMANOTE = [
  'jp-東日本旅客鉄道-山手線:004095-004135',
  'jp-東日本旅客鉄道-山手線:004135-004110',
];

/** Write ride events straight into the app's IndexedDB ('railprint' → 'rideEvents'), mirroring db.ts. */
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

const bootedDb = async () => (await indexedDB.databases()).some((d) => d.name === 'railprint');

test('OFFLINE: after one online load, the app boots with NO network and the real package loads from the SW cache', async ({
  page,
  context,
}) => {
  // 1. First load online — the app boots and registers the offline service worker.
  await page.goto('/?e2e=1');
  await page.waitForFunction(bootedDb, null, { timeout: 20_000 });
  await seedRides(page);

  // 2. Wait until the SW actually controls the page AND has precached the 8.8 MB JP package — going
  //    offline before precache finishes would (correctly) degrade to the stub and prove nothing.
  await page.waitForFunction(
    async () => {
      if (!navigator.serviceWorker?.controller) return false;
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        if (await cache.match('/rail/jp-2025.json', { ignoreSearch: true })) return true;
      }
      return false;
    },
    null,
    { timeout: 45_000 },
  );

  // 3. Cut the network entirely and reload — every byte must now come from the SW cache.
  await context.setOffline(true);
  await page.reload();

  // 4. The app boots offline AND the seeded 山手線 ride resolves against the REAL package: the
  //    per-country 日本 card only appears if the full network (not the 1-line stub) loaded from cache.
  await page.waitForFunction(bootedDb, null, { timeout: 20_000 });
  await expect(page.getByText('日本 全国')).toBeVisible({ timeout: 20_000 });

  await context.setOffline(false);
});
