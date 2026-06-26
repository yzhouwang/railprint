import { test, expect, type Page } from '@playwright/test';

// Import flow E2E (TEST-PLAN "Cold-start trust" + the replace-mode data-safety guard). Runs on the
// non-map import/stats screens, so no WebGL beyond the app booting. Input is an OWN-EXPORT CSV
// (header + explicit segmentId) so it resolves deterministically — the fuzzy incumbent-CSV path is
// covered at the unit layer (import/parse.test.ts, commit.test.ts).

const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const SEG = 'jp-東日本旅客鉄道-山手線:0-1'; // a real JP segment from public/rail/jp-2025.json

function exportCsv(segmentId: string, tripId: string, date = '2025-04-01'): string {
  return [
    'segmentId,lineId,railGeoVersion,rode,source,tripId,createdAt,date,trainModel',
    `${segmentId},,2025.1.0,true,import,${tripId},${date}T00:00:00.000Z,${date},`,
  ].join('\n');
}

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ contentType: 'image/png', body: BLANK_PNG }),
  );
});

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

test('COLD-START: pasting an export CSV fills the map — stats show 日本 coverage', async ({ page }) => {
  await gotoImport(page);
  await pasteAndParse(page, exportCsv(SEG, 'trip-cold'));
  await page.getByRole('button', { name: /件を取り込む/ }).click();
  await expect(page.getByText(/件を取り込みました/)).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: '統計' }).first().click();
  await expect(page.getByText('日本 全国')).toBeVisible({ timeout: 15_000 });
});

test('REPLACE is guarded — it shows a confirm step before wiping, then completes on confirm', async ({ page }) => {
  await gotoImport(page);
  // an initial ride via the default merge mode
  await pasteAndParse(page, exportCsv(SEG, 'trip-1'));
  await page.getByRole('button', { name: /件を取り込む/ }).click();
  await expect(page.getByText(/件を取り込みました/)).toBeVisible({ timeout: 15_000 });

  // import again, this time in REPLACE mode
  await page.getByRole('button', { name: '続けて取り込む' }).click();
  await pasteAndParse(page, exportCsv(SEG, 'trip-2'));
  await page.getByRole('button', { name: '置き換え' }).click();
  await page.getByRole('button', { name: /件を取り込む/ }).click();

  // the destructive replace does NOT wipe immediately — it routes through an explicit confirm.
  await expect(page.getByText('置き換えの確認')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'すべて削除して置き換える' }).click();
  await expect(page.getByText(/件を取り込みました/)).toBeVisible({ timeout: 15_000 });
});
