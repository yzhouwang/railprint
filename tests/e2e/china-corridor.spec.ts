import { test, expect, type Page } from '@playwright/test';

// T4/T5 end to end: the built CN corridor package loads alongside JP, and a China ride surfaces a
// per-country 中国 StatCard on 統計 (never folded into a blended "全国 %"). Runs on the non-map
// stats screen, so no WebGL needed.

const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// A real segment id from the built 京沪 corridor (public/rail/cn-jinghu-2025.json).
const CN_SEG = 'cn-中国铁路-京沪高速铁路:1-2';

async function seedCnRide(page: Page): Promise<void> {
  await page.evaluate(async (seg) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('railprint');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('rideEvents', 'readwrite');
        tx.objectStore('rideEvents').put({
          id: crypto.randomUUID(), segmentId: seg, railGeoVersion: '2025.1.0', source: 'manual', createdAt: new Date().toISOString(),
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, CN_SEG);
}

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ contentType: 'image/png', body: BLANK_PNG }),
  );
});

test('a China ride loads the CN corridor and shows a per-country 中国 card', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.waitForFunction(
    async () => (await indexedDB.databases()).some((d) => d.name === 'railprint'),
    null,
    { timeout: 20_000 },
  );
  await seedCnRide(page);
  await page.reload();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => (window as any).__mapReady === true, null, { timeout: 30_000 });

  // The CN package must have loaded (else the ride resolves to nothing and no 中国 card appears).
  // The card's folder-tab renders "■中国", so match the label as a substring, not exact.
  await page.getByRole('button', { name: /統計/ }).first().click();
  await expect(page.getByText('中国').first()).toBeVisible({ timeout: 15_000 });
});
