import { test, expect, type Page } from '@playwright/test';

// T1/T2 end to end on the NON-map 統計 screen (so it runs without WebGL): seed the SAME journey
// twice (two tripIds on one segment) — the append model (E1) — and assert the diary shows it as
// TWO distinct dated rows (D2: date-led, never collapsed), with the captured train model on its row.

const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const SEG = 'jp-東日本旅客鉄道-山手線:004095-004135'; // a real segment in the shipped JP package

async function seedTwoTrips(page: Page): Promise<void> {
  await page.evaluate(async (seg) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('railprint');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('rideEvents', 'readwrite');
        const store = tx.objectStore('rideEvents');
        // Same A→B ridden on two different days = two journeys; one carries a train model.
        store.put({ id: `t1:${seg}`, segmentId: seg, railGeoVersion: '2025.1.0', source: 'manual', tripId: 't1', date: '2025-11-03', trainModel: 'E235系', createdAt: '2025-11-03T00:00:00.000Z' });
        store.put({ id: `t2:${seg}`, segmentId: seg, railGeoVersion: '2025.1.0', source: 'manual', tripId: 't2', date: '2026-01-15', createdAt: '2026-01-15T00:00:00.000Z' });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, SEG);
}

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ contentType: 'image/png', body: BLANK_PNG }),
  );
});

test('diary shows a repeat journey as two dated rows + the captured train model', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.waitForFunction(
    async () => (await indexedDB.databases()).some((d) => d.name === 'railprint'),
    null,
    { timeout: 20_000 },
  );
  await seedTwoTrips(page);
  await page.reload();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => (window as any).__mapReady === true, null, { timeout: 30_000 });

  // Switch to 統計 — the diary lives on a folder-tab card there (no map needed).
  await page.getByRole('button', { name: /統計/ }).first().click();

  // The same journey twice → TWO distinct rows (the append model made legible by the date).
  const trips = page.locator('.trip');
  await expect(trips).toHaveCount(2, { timeout: 15_000 });

  // Date-led identity (D2) + the captured model surfaced on its row.
  await expect(page.getByText('2026.01.15')).toBeVisible();
  await expect(page.getByText('2025.11.03')).toBeVisible();
  await expect(page.getByText('E235系').first()).toBeVisible();
});
