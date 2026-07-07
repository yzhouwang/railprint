import { test, expect, type Page } from '@playwright/test';

// Phase 2 — OFFLINE. The whole promise of an offline-first ride tracker is: mark a ride with no
// signal. These prove the Workbox service worker delivers it end-to-end — after ONE online load the
// network is cut and (1) the app boots with the REAL package served from the SW cache (not the
// JP-only stub), and (2) a brand-new ride can still be recorded. Without the SW, that reload is a
// browser "no internet" page; that regression is what this guards.

const VERSION = '2025.2.0';
const RIDDEN_YAMANOTE = [
  'jp-東日本旅客鉄道-山手線:004095-004135',
  'jp-東日本旅客鉄道-山手線:004135-004110',
];
const DEGRADED_BANNER = '鉄道網データを読み込めませんでした'; // shown ONLY when rides can't resolve (stub loaded)

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

/** Wait until the SW controls the page AND has precached BOTH the manifest and the 8.8 MB package —
 *  going offline before precache finishes would (correctly) degrade to the stub and prove nothing. */
async function waitForPrecache(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      if (!navigator.serviceWorker?.controller) return false;
      let pkg = false;
      let manifest = false;
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        if (await cache.match('/rail/jp-2025.json', { ignoreSearch: true })) pkg = true;
        if (await cache.match('/rail/manifest.json', { ignoreSearch: true })) manifest = true;
      }
      return pkg && manifest;
    },
    null,
    { timeout: 45_000 },
  );
}

test('OFFLINE boot: with the network cut, the REAL package (not the stub) loads from the SW cache', async ({
  page,
  context,
}) => {
  await page.goto('/?e2e=1');
  await page.waitForFunction(bootedDb, null, { timeout: 20_000 });
  await seedRides(page);
  await waitForPrecache(page);

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(bootedDb, null, { timeout: 20_000 });

  // The per-country 日本 card only renders if the full network loaded; and the degraded banner —
  // shown ONLY when a ride can't resolve (i.e. the 1-line stub loaded) — must be ABSENT. Together
  // that distinguishes "real 8.8 MB package served offline from cache" from "fell back to the stub".
  await page.getByRole('button', { name: /統計/ }).first().click();
  await expect(page.getByText('日本 全国')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(DEGRADED_BANNER)).toHaveCount(0);

  await context.setOffline(false);
});

test('OFFLINE record: a brand-new ride is marked and persisted with no signal', async ({ page, context }) => {
  await page.goto('/?e2e=1');
  await page.waitForFunction(bootedDb, null, { timeout: 20_000 });
  await seedRides(page); // a JP ride so the map + mark FAB are reachable
  await waitForPrecache(page);

  await context.setOffline(true);
  await page.reload();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => (window as any).__mapReady === true, null, { timeout: 30_000 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window as any).__map?.fire('load'));

  // Mark a NEW ride OFFLINE: search two real CN stations (only present if the real package came from
  // cache) and let the single-line 京沪 route auto-record. The success toast confirms the offline write.
  await page.getByRole('button', { name: '区間をマーク' }).first().click();
  await page.getByRole('tab', { name: '駅名で検索' }).click();
  await page.locator('#rp-q-a').fill('北京南');
  await page.locator('.hit').first().click();
  await page.locator('#rp-q-b').fill('上海虹桥');
  await page.locator('.hit').first().click();
  await expect(page.getByText(/経路を記録しました/)).toBeVisible({ timeout: 15_000 });

  // And it truly persisted to IndexedDB — survives offline with no network round-trip.
  const count = await page.evaluate(
    async () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('railprint');
        open.onsuccess = () => {
          const req = open.result.transaction('rideEvents', 'readonly').objectStore('rideEvents').count();
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
        open.onerror = () => reject(open.error);
      }),
  );
  expect(count).toBeGreaterThan(RIDDEN_YAMANOTE.length); // the offline-recorded ride was added

  await context.setOffline(false);
});
