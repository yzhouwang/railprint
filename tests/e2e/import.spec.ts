import { test, expect, type Page } from '@playwright/test';

// Import flow E2E (TEST-PLAN "Cold-start trust" + the replace-mode data-safety guard). Runs on the
// non-map import/stats screens, so no WebGL beyond the app booting. Input is an OWN-EXPORT CSV
// (header + explicit segmentId) so it resolves deterministically — the fuzzy incumbent-CSV path is
// covered at the unit layer (import/parse.test.ts, commit.test.ts).

const SEG = 'jp-東日本旅客鉄道-山手線:004095-004135'; // a real JP segment from public/rail/jp-2025.json

function exportCsv(segmentId: string, tripId: string, date = '2025-04-01'): string {
  return [
    'segmentId,lineId,railGeoVersion,rode,source,tripId,createdAt,date,trainModel',
    `${segmentId},,2025.2.0,true,import,${tripId},${date}T00:00:00.000Z,${date},`,
  ].join('\n');
}

async function gotoImport(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.waitForFunction(
    async () => (await indexedDB.databases()).some((d) => d.name === 'railprint'),
    null,
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: '取込' }).first().click();
}

async function pasteAndParse(page: Page, csv: string): Promise<void> {
  await page.getByText('または CSV を貼り付け').click(); // open the <details>
  await page.locator('#paste-area').fill(csv);
  await page.getByRole('button', { name: '貼り付けたCSVを取り込む' }).click();
}

// Read the segmentIds currently in the rideEvents store — to prove what a replace actually did.
async function readSegments(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('railprint');
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('rideEvents', 'readonly').objectStore('rideEvents').getAll();
          req.onsuccess = () => {
            db.close();
            resolve((req.result as { segmentId: string }[]).map((e) => e.segmentId));
          };
          req.onerror = () => reject(req.error);
        };
        open.onerror = () => reject(open.error);
      }),
  );
}

test('COLD-START: pasting an export CSV fills the map — stats show 日本 coverage', async ({ page }) => {
  await gotoImport(page);
  await pasteAndParse(page, exportCsv(SEG, 'trip-cold'));
  await page.getByRole('button', { name: /件を取り込む/ }).click();
  await expect(page.getByText(/件を取り込みました/)).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: '統計' }).first().click();
  await expect(page.getByText('日本 全国')).toBeVisible({ timeout: 15_000 });
});

const SEG2 = 'jp-東日本旅客鉄道-山手線:004135-004110'; // a second real segment, distinct from SEG

test('REPLACE is guarded — confirm before wiping, and it truly swaps old data for new', async ({ page }) => {
  await gotoImport(page);
  // an initial ride (segment :0-1) via the default merge mode
  await pasteAndParse(page, exportCsv(SEG, 'trip-1'));
  await page.getByRole('button', { name: /件を取り込む/ }).click();
  await expect(page.getByText(/件を取り込みました/)).toBeVisible({ timeout: 15_000 });

  // import a DIFFERENT segment (:1-2) in REPLACE mode
  await page.getByRole('button', { name: '続けて取り込む' }).click();
  await pasteAndParse(page, exportCsv(SEG2, 'trip-2'));
  await page.getByRole('button', { name: '置き換え' }).click();
  await page.getByRole('button', { name: /件を取り込む/ }).click();

  // the destructive replace does NOT wipe immediately — it routes through an explicit confirm,
  // and the OLD ride is still in the store until the user confirms.
  await expect(page.getByText('置き換えの確認')).toBeVisible({ timeout: 10_000 });
  expect(await readSegments(page)).toContain(SEG);

  await page.getByRole('button', { name: 'すべて削除して置き換える' }).click();
  await expect(page.getByText(/置き換えました/)).toBeVisible({ timeout: 15_000 });

  // after confirm: ONLY the replacement segment remains, the original is gone.
  const after = await readSegments(page);
  expect(after).toContain(SEG2);
  expect(after).not.toContain(SEG);
});
