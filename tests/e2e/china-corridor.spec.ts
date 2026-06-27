import { test, expect, type Page } from '@playwright/test';

// T3–T5 end to end. Two layers:
//  1. a resolver/render SMOKE test (seed a CN ride straight into IndexedDB) — fast proof the built
//     corridor loads + the per-country 中国 card renders.
//  2. a REAL-USER flow — mark mode → search 北京南 → 上海虹桥 → record the route with a train model →
//     stats show 中国 → the diary shows the model. This is the one that proves a person can actually
//     log a China ride, not just that a pre-seeded row resolves.
// Runs on the non-map stats screen for assertions, so no WebGL is needed beyond booting the map.

const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const CN_SEG = 'cn-中国铁路-京沪高速铁路:1-2'; // a real segment from public/rail/cn-jinghu-2025.json

async function seedRide(page: Page, segmentId: string): Promise<void> {
  await page.evaluate(async (seg) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('railprint');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('rideEvents', 'readwrite');
        tx.objectStore('rideEvents').put({
          id: crypto.randomUUID(), segmentId: seg, railGeoVersion: '2025.2.0', source: 'manual', createdAt: new Date().toISOString(),
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, segmentId);
}

// Boot with a ride (so the map mounts), fire 'load' (the offline CI basemap never does), open mark
// mode + the station-search tab — the entry for the real-user flow.
async function enterSearchMode(page: Page, seedSegment: string): Promise<void> {
  await page.goto('/?e2e=1');
  await page.waitForFunction(
    async () => (await indexedDB.databases()).some((d) => d.name === 'railprint'),
    null,
    { timeout: 20_000 },
  );
  await seedRide(page, seedSegment);
  await page.reload();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => (window as any).__mapReady === true, null, { timeout: 30_000 });
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

test('SMOKE: a seeded China ride loads the corridor and shows the per-country 中国 card', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.waitForFunction(
    async () => (await indexedDB.databases()).some((d) => d.name === 'railprint'),
    null,
    { timeout: 20_000 },
  );
  await seedRide(page, CN_SEG);
  await page.reload();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => (window as any).__mapReady === true, null, { timeout: 30_000 });
  await page.getByRole('button', { name: /統計/ }).first().click();
  await expect(page.getByText('中国').first()).toBeVisible({ timeout: 15_000 });
});

test('REAL FLOW: search 北京南 → 上海虹桥, record with a train model, see 中国 stats + the model in the diary', async ({ page }) => {
  // Seed a JP ride first so the map (and the mark FAB) is reachable — a Japan rider adding China.
  await enterSearchMode(page, 'jp-東日本旅客鉄道-山手線:004095-004135');

  // Search two China stations by name and pick them.
  await page.locator('#rp-q-a').fill('北京南');
  await page.locator('.hit').first().click();

  // Tag the train BEFORE the destination (a single-line CN route auto-records on pick).
  await page.locator('#rp-train').fill('CR400AF');
  await page.locator('#rp-q-b').fill('上海虹桥');
  await page.locator('.hit').first().click();

  // 北京南 → 上海虹桥 is the whole 京沪 line (one line, 0 changes) → it records automatically.
  await expect(page.getByText(/経路を記録しました/)).toBeVisible({ timeout: 15_000 });

  // Stats now show a China figure, and the diary row carries the model + the true endpoints.
  await page.getByRole('button', { name: /統計/ }).first().click();
  await expect(page.getByText('中国').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('CR400AF').first()).toBeVisible({ timeout: 15_000 });
  const route = page.locator('.trip-route').first();
  await expect(route).toContainText('北京南');
  await expect(route).toContainText('上海虹桥');
});

test('MOBILE: per-country cards (never a blended 全国) on the mobile map screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // phone → mobile layout (MapScreen float card)
  await page.goto('/?e2e=1');
  await page.waitForFunction(
    async () => (await indexedDB.databases()).some((d) => d.name === 'railprint'),
    null,
    { timeout: 20_000 },
  );
  await seedRide(page, 'jp-東日本旅客鉄道-山手線:004095-004135'); // a Japan ride
  await seedRide(page, CN_SEG); // and a China ride
  await page.reload();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => (window as any).__mapReady === true, null, { timeout: 30_000 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window as any).__map?.fire('load'));
  // the floating cards are per-country — Japan's own 全国 figure AND a separate 中国 card; if the
  // mobile screen had kept the blended card it would read just "全国" with no 中国 card at all.
  await expect(page.getByText('日本 全国').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('中国').first()).toBeVisible();
});

test('DISCOVERABLE: the line picker has a 中国 filter that surfaces 京沪高速铁路 in one tap', async ({ page }) => {
  await enterSearchMode(page, 'jp-東日本旅客鉄道-山手線:004095-004135');
  // back to the default tap-mode picker, where the country filter lives
  await page.getByRole('tab', { name: '地図でタップ' }).click();
  await expect(page.getByRole('tab', { name: '中国' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: '中国' }).click();
  // the corridor is now one tap away, not buried under 594 JP lines
  await page.getByRole('button', { name: /京沪高速铁路/ }).click();
  await expect(page.getByText(/出発駅/).first()).toBeVisible(); // line selected → A→B step
});
