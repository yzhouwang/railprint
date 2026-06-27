import { test, expect, type Page } from '@playwright/test';

// Phase 4 — QUARANTINE. When a data refresh abolishes the track a ride was recorded on, the ride
// becomes an "orphan": its segmentId no longer exists in the loaded package. Instead of silently
// dropping it from coverage, the 統計 screen surfaces a calm 確認待ち card → a review sheet where the
// user keeps it as closed-line history. This proves the full path: a seeded orphan appears, and
// keeping it moves it into the positive 廃線 stat (NOT the degraded "network failed" banner, since
// the package loaded fine — only one segment is gone).

const VERSION = '2025.2.0';
const REAL_SEG = 'jp-東日本旅客鉄道-山手線:004095-004135'; // resolves → riddenKm > 0 → stats render
const ORPHAN_SEG = 'jp-廃止鉄道-廃線:999000-998000'; // jp- namespace, but no such segment in the package

/** Seed a real ride + an orphan ride (with a km snapshot) straight into IndexedDB, mirroring db.ts. */
async function seed(page: Page): Promise<void> {
  await page.evaluate(
    async ({ realSeg, orphanSeg, version }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('railprint');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('rideEvents', 'readwrite');
          const store = tx.objectStore('rideEvents');
          store.put({ id: crypto.randomUUID(), segmentId: realSeg, railGeoVersion: version, source: 'manual', date: '2025-11-03', createdAt: new Date().toISOString() });
          store.put({ id: crypto.randomUUID(), segmentId: orphanSeg, railGeoVersion: version, source: 'manual', date: '2025-05-01', km: 42, createdAt: new Date().toISOString() });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      });
    },
    { realSeg: REAL_SEG, orphanSeg: ORPHAN_SEG, version: VERSION },
  );
}

const bootedDb = async () => (await indexedDB.databases()).some((d) => d.name === 'railprint');

test('QUARANTINE: an orphaned ride surfaces in 統計 and "keep as a closed line" moves it to the 廃線 stat', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.waitForFunction(bootedDb, null, { timeout: 20_000 });
  await seed(page);
  await page.reload();
  await page.waitForFunction(bootedDb, null, { timeout: 20_000 });

  // Go to 統計. The orphan must NOT raise the degraded banner (the package loaded fine).
  await page.getByRole('button', { name: /統計/ }).first().click();
  await expect(page.getByText('鉄道網データを読み込めませんでした')).toHaveCount(0);

  // The calm 確認待ち card appears; open the review sheet.
  await expect(page.getByText('確認待ち').first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '確認する' }).click();
  await expect(page.getByText('確認待ちの記録')).toBeVisible();
  await expect(page.getByText('廃線', { exact: true }).first()).toBeVisible(); // the parsed line label

  // Keep the whole line as closed-line history.
  await page.getByRole('button', { name: /すべて廃線として残す/ }).click();
  await expect(page.getByText('すべて確認済みです')).toBeVisible({ timeout: 10_000 });

  // Close the sheet → the orphan is now a positive 廃線 stat (42 km), and the 確認待ち card is gone.
  await page.getByRole('button', { name: '統計に戻る' }).click();
  await expect(page.getByText('42 km')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: '確認する' })).toHaveCount(0);
});

/** Seed only an orphan (no resolved ride) straight into IndexedDB → riddenKm stays 0 (!hasRides). */
async function seedOrphanOnly(page: Page): Promise<void> {
  await page.evaluate(
    async ({ orphanSeg, version }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('railprint');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('rideEvents', 'readwrite');
          tx.objectStore('rideEvents').put({ id: crypto.randomUUID(), segmentId: orphanSeg, railGeoVersion: version, source: 'manual', date: '2025-05-01', km: 7, createdAt: new Date().toISOString() });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      });
    },
    { orphanSeg: ORPHAN_SEG, version: VERSION },
  );
}

test('QUARANTINE: an all-orphaned log (riddenKm 0) still reaches the review, not the cold-start empty state', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.waitForFunction(bootedDb, null, { timeout: 20_000 });
  await seedOrphanOnly(page);
  await page.reload();
  await page.waitForFunction(bootedDb, null, { timeout: 20_000 });

  // hasRides is false (no resolved ride), but the app must NOT show the global cold-start EmptyState —
  // the 統計 tab reaches the 確認待ち card so the user can act on rides whose track was abolished.
  await page.getByRole('button', { name: /統計/ }).first().click();
  await expect(page.getByText('確認待ち').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('鉄道網データを読み込めませんでした')).toHaveCount(0);
  await page.getByRole('button', { name: '確認する' }).click();
  await expect(page.getByText('確認待ちの記録')).toBeVisible();
});
