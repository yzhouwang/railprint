import { test, expect, type Page } from '@playwright/test';

// Cross-line route marking, end to end: search 津 → 大阪難波 (特急ひのとり spans 名古屋線→大阪線→難波線)
// and confirm the route-picker surfaces a multi-line route that single-line marking could never reach.
// Uses the same headless-WebGL harness as map-lod.spec.ts.

const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// A ride so the app boots into the map (not the empty state) and the mark FAB is reachable.
async function seedRide(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('railprint');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('rideEvents', 'readwrite');
        tx.objectStore('rideEvents').put({
          id: crypto.randomUUID(),
          segmentId: 'jp-東日本旅客鉄道-山手線:0-1',
          railGeoVersion: '2025.1.0',
          source: 'manual',
          createdAt: new Date().toISOString(),
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
}

// Boot the app with a ride (so the map mounts), fire 'load' (the offline CI basemap never does), then
// open mark mode and the station-search tab — the shared entry for both tests.
async function enterSearchMode(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.waitForFunction(
    async () => (await indexedDB.databases()).some((d) => d.name === 'railprint'),
    null,
    { timeout: 20_000 },
  );
  await seedRide(page);
  await page.reload();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => (window as any).__mapReady === true, null, { timeout: 30_000 });
  // Status (and the mark panel) won't reach 'ready' until MapLibre fires 'load', which the offline
  // basemap suppresses — fire it via the e2e handle (harness affordance; the UI flow under test is real).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window as any).__map?.fire('load'));
  await page.getByRole('button', { name: '区間をマーク' }).first().click();
  await page.getByRole('tab', { name: '駅名で検索' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ contentType: 'image/png', body: BLANK_PNG }),
  );
});

test('search 津 → 大阪難波 surfaces a multi-line route and records it', async ({ page }) => {
  await enterSearchMode(page);

  // 津 has three instances (伊勢鉄道 / 近鉄名古屋線 / JR紀勢) — they share one transfer group, so any hit
  // resolves to the same group. Type, then pick the first candidate.
  await page.locator('#rp-q-a').fill('津');
  await page.locator('.hit').first().click();

  // 大阪難波 (難波線 / 阪神なんば線) — same: pick the first candidate.
  await page.locator('#rp-q-b').fill('大阪難波');
  await page.locator('.hit').first().click();

  // The route-picker must offer at least one MULTI-line route (the through-service across ≥2 lines) —
  // exactly what the old single-line flow could not represent.
  const routeChip = page.locator('.route-chip').first();
  await expect(routeChip).toBeVisible({ timeout: 15_000 });
  await expect(routeChip).toContainText('路線'); // metadata "N路線", N ≥ 2
  await expect(routeChip).toContainText('大阪線');

  // Record it; the success toast confirms the cross-line ride landed.
  await routeChip.click();
  await expect(page.getByText(/経路を記録しました/)).toBeVisible({ timeout: 10_000 });
});

test('does NOT auto-pick while typing — a single match is a tappable suggestion', async ({ page }) => {
  await enterSearchMode(page);

  // 首里 (沖縄都市モノレール) is a single-instance station. Typing its exact name used to auto-SELECT it
  // immediately — the bug where a partial like "nago" locks onto one station before you finish 名古屋.
  await page.locator('#rp-q-a').fill('首里');

  // It must be OFFERED as a tappable suggestion, never silently chosen.
  await expect(page.locator('.hit')).toHaveCount(1);
  await expect(page.locator('.picked-station')).toHaveCount(0); // not auto-picked
  await expect(page.locator('#rp-q-a')).toHaveValue('首里'); // the input keeps what you typed

  // Tapping the suggestion is what selects it.
  await page.locator('.hit').first().click();
  await expect(page.locator('.picked-station')).toHaveCount(1);
});
