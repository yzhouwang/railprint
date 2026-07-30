import { test, expect, type Page } from '@playwright/test';

// v0.13 車両図鑑 end to end (plan T8). Three seeded WebGL-free flows on the 統計 screen
// (shelf → sheet → detail; the enrichment funnel; CN-only + zero-model states) plus one
// live-mark flow through the route-picker asserting the D14 first-collect toast and its
// DD4 tap-through into the sheet. Flake-resistant prop asserts, no pixels.

const JP_SEG = 'jp-東日本旅客鉄道-山手線:004095-004135'; // real segment in the shipped JP package
const CN_SEG = 'cn-中国铁路-京沪高速铁路:1-2'; //           real segment in the CN corridor package

interface SeedRow {
  id: string;
  segmentId: string;
  railGeoVersion: string;
  source: string;
  tripId?: string;
  date?: string;
  trainModel?: string;
  createdAt: string;
}

async function seed(page: Page, rows: SeedRow[]): Promise<void> {
  await page.evaluate(async (data) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('railprint');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('rideEvents', 'readwrite');
        const store = tx.objectStore('rideEvents');
        for (const row of data) store.put(row);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, rows);
}

async function bootToStats(page: Page, rows: SeedRow[]): Promise<void> {
  await page.goto('/?e2e=1');
  await page.waitForFunction(
    async () => (await indexedDB.databases()).some((d) => d.name === 'railprint'),
    null,
    { timeout: 20_000 },
  );
  await seed(page, rows);
  await page.reload();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => (window as any).__mapReady === true, null, { timeout: 30_000 });
  await page.getByRole('button', { name: /統計/ }).first().click();
}

test('collect → shelf meter → sheet: collected card, ghost want-list, stamps, detail view', async ({ page }) => {
  await bootToStats(page, [
    { id: 't1:' + JP_SEG, segmentId: JP_SEG, railGeoVersion: '2025.2.0', source: 'manual', tripId: 't1', date: '2025-11-03', trainModel: 'E5系', createdAt: '2025-11-03T00:00:00.000Z' },
    // batch-2 raster coverage: a CJK-fold 特急 — its collected card proves the
    // percent-encoded asset URL decodes in a real browser (キハ261.webp)
    { id: 't2:' + JP_SEG, segmentId: JP_SEG, railGeoVersion: '2025.2.0', source: 'manual', tripId: 't2', date: '2025-11-04', trainModel: 'キハ261系', createdAt: '2025-11-04T00:00:00.000Z' },
  ]);

  // DD1 shelf: one job — count + hero meter + chevron; whole shelf is the button.
  const shelf = page.locator('.dex-shelf');
  await expect(shelf).toBeVisible({ timeout: 15_000 });
  await expect(shelf).toContainText('車両図鑑');
  await expect(shelf).toContainText('2車両を記録'); // E5系 + キハ261系 (batch-2 raster seed)
  await expect(shelf).toContainText('/13'); // 新幹線 denominator (2026 roster, fact-checked)

  // Open the sheet (DD9 dialog) — anchor meter + collected E5系 + a ghost card + 引退迫る tag.
  await shelf.click();
  const sheet = page.getByRole('dialog', { name: /車両図鑑/ });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('あと12形式')).toBeVisible(); // 1/13 anchor meter sub
  const collected = sheet.getByRole('button', { name: /E5系/ });
  await expect(collected).toBeVisible();
  await expect(sheet.getByText('未乗車').first()).toBeVisible(); // ghost want-list (value+label, not hue alone)

  // D21 raster art actually renders in BOTH states — a broken asset URL or mask rule
  // would leave blank boxes while every other assertion here stays green.
  const collectedArt = collected.locator('img[src*="silhouettes/"]');
  await expect(collectedArt).toBeVisible();
  expect(await collectedArt.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const ghostMask = sheet.locator('.card.ghost .ras .mask').first();
  await expect(ghostMask).toBeVisible();
  const maskBox = await ghostMask.boundingBox();
  expect(maskBox && maskBox.width > 10 && maskBox.height > 10).toBe(true);

  // Batch-2 (特急) raster coverage — both states, in a REAL browser:
  // 1. collected キハ261系: the CJK asset URL must decode (percent-encoded round-trip).
  const kiha = sheet.getByRole('button', { name: /キハ261系/ });
  const kihaArt = kiha.locator('img[src*="silhouettes/"]');
  await expect(kihaArt).toBeVisible();
  expect(await kihaArt.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // 2. a ltd-express GHOST (E353系): the box assert alone is vacuous for masks (a 404
  //    mask still has size) — fetch the actual --sil-mask URL and require the asset bytes.
  const e353Mask = sheet.locator('.card.ghost[data-fold="E353"] .ras .mask');
  await expect(e353Mask).toBeVisible();
  const maskOk = await e353Mask.evaluate(async (el) => {
    const url = getComputedStyle(el).getPropertyValue('--sil-mask').trim().slice(5, -2); // url('…')
    const res = await fetch(url);
    return res.ok && (await res.blob()).size > 10_000;
  });
  expect(maskOk, 'E353 ghost mask URL must serve the real asset').toBe(true);
  await expect(sheet.getByText('引退迫る').first()).toBeVisible(); // 500系 honest urgency tag
  await expect(sheet.getByText(`ロースター基準: 2026年`)).toBeVisible();

  // Stamps (DD7 typographic): 初車両 + 320km/hクラブ earned by E5; コンプリート still locked.
  await expect(sheet.getByText('初車両')).toBeVisible();
  await expect(sheet.getByText('320km/hクラブ')).toBeVisible();

  // DD14 detail swap: card → detail (← 戻る header, DD15 stat labels), back restores the grid.
  // The dialog's accessible name follows the view (車両図鑑 → the model name), so re-locate
  // it generically after the swap.
  await collected.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('乗車回数')).toBeVisible();
  await expect(dialog.getByText('初乗車日')).toBeVisible();
  await expect(dialog.getByText('この車両の旅')).toBeVisible();
  await dialog.getByRole('button', { name: /戻る/ }).click();
  await expect(dialog.getByText('あと12形式')).toBeVisible();

  // Escape closes (DD13).
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('未記録 funnel: toggle filters to model-less trips; the inline editor drains the count', async ({ page }) => {
  await bootToStats(page, [
    { id: 't1:' + JP_SEG, segmentId: JP_SEG, railGeoVersion: '2025.2.0', source: 'manual', tripId: 't1', date: '2025-11-03', trainModel: 'E5系', createdAt: '2025-11-03T00:00:00.000Z' },
    { id: 't2:' + JP_SEG, segmentId: JP_SEG, railGeoVersion: '2025.2.0', source: 'import', tripId: 't2', date: '2026-01-15', createdAt: '2026-01-15T00:00:00.000Z' },
  ]);

  // DD3: the funnel lives on the 旅の記録 card; toggling narrows to model-less trips only.
  const toggle = page.getByRole('button', { name: /未記録のみ 1/ });
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  await toggle.click();
  await expect(page.locator('.trip')).toHaveCount(1);

  // DD5: ＋車両 opens the inline editor; typing shows the D15 canonical preview; 保存 commits.
  await page.getByRole('button', { name: /＋車両/ }).click();
  const input = page.locator('#dex-edit-input');
  await expect(input).toBeFocused();
  await input.fill('e7系');
  await expect(page.getByText('→ E7 として記録')).toBeVisible();
  await page.getByRole('button', { name: '保存' }).click();

  // Undo-able success toast; the funnel count drains to zero (toggle disappears).
  await expect(page.getByText(/車両を「E7」に更新しました/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /未記録のみ/ })).toHaveCount(0);
  // Draining the LAST untagged trip must return the FULL diary, never a blank filtered
  // list with the toggle gone (review fix: the filter auto-resets at zero).
  await expect(page.locator('.trip')).toHaveCount(2);
  // The freshly-tagged model joins the diary pills and the shelf count ticks to 2.
  await expect(page.locator('.dex-shelf')).toContainText('2車両を記録');

  // Editing an EXISTING pill (ship coverage gap): tap the E7 pill → editor prefilled →
  // change to E6 → the pill relabels and the trip never loses its other data.
  await page.getByRole('button', { name: 'E7系', exact: true }).click();
  const editInput = page.locator('#dex-edit-input');
  await expect(editInput).toHaveValue('E7系');
  await editInput.fill('E6');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText(/車両を「E6」に更新しました/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'E6系', exact: true })).toBeVisible();
});

test('CN-only rider: the shelf hero meter is the earnable 京沪 corridor, never a JP 0/13', async ({ page }) => {
  await bootToStats(page, [
    { id: 't1:cn', segmentId: CN_SEG, railGeoVersion: '2025.1.0', source: 'manual', tripId: 't1', date: '2025-09-20', trainModel: 'CR400AF', createdAt: '2025-09-20T00:00:00.000Z' },
  ]);

  const shelf = page.locator('.dex-shelf');
  await expect(shelf).toBeVisible({ timeout: 15_000 });
  await expect(shelf).toContainText('1車両を記録');
  await expect(shelf).toContainText('/4'); // 京沪で会える車両 1/4 (11B corridor meter)
  await expect(shelf).not.toContainText('/13'); // no dispiriting JP roster meter (DD15)

  await shelf.click();
  const sheet = page.getByRole('dialog', { name: /車両図鑑/ });
  await expect(sheet.getByText('京沪で会える車両')).toBeVisible();
  await expect(sheet.getByRole('button', { name: /CR400AF/ })).toBeVisible();
});

test('zero models but rides exist: the shelf invites instead of shaming; the sheet keeps the want-list', async ({ page }) => {
  await bootToStats(page, [
    { id: 't1:' + JP_SEG, segmentId: JP_SEG, railGeoVersion: '2025.2.0', source: 'import', tripId: 't1', date: '2026-01-15', createdAt: '2026-01-15T00:00:00.000Z' },
  ]);

  // DD15 state 1: never a 0/13 meter — a warm invite instead.
  const shelf = page.locator('.dex-shelf');
  await expect(shelf).toBeVisible({ timeout: 15_000 });
  await expect(shelf).toContainText('車両を記録すると図鑑が育ちます');
  await expect(shelf).not.toContainText('/13');

  // The sheet still shows the ghost roster — the encyclopedia IS the invitation.
  await shelf.click();
  const sheet = page.getByRole('dialog', { name: /車両図鑑/ });
  await expect(sheet.getByText('未乗車').first()).toBeVisible();
});

test('editor chips are plausibility-gated: profile stock on 山手線, honest hint on an unprofiled line', async ({ page }) => {
  // v0.13.1 v3 gate regression pin (user report 2026-07-10): the v2 editor padded the CN-first
  // KNOWN list (CR400AF…) on EVERY trip. Now chips come from the trip lines' service profiles,
  // and an unprofiled line shows the free-text hint instead of confidently-wrong chips.
  const GINZA_SEG = 'jp-東京地下鉄-3号線銀座線:003922-003883'; // real segment; 銀座線 has no profile
  await bootToStats(page, [
    { id: 't1:' + JP_SEG, segmentId: JP_SEG, railGeoVersion: '2025.2.0', source: 'import', tripId: 't1', date: '2026-01-15', createdAt: '2026-01-15T00:00:00.000Z' },
    { id: 't2:' + GINZA_SEG, segmentId: GINZA_SEG, railGeoVersion: '2025.2.0', source: 'import', tripId: 't2', date: '2026-02-01', createdAt: '2026-02-01T00:00:00.000Z' },
  ]);
  await expect(page.locator('.trip')).toHaveCount(2, { timeout: 15_000 });

  // Unprofiled 銀座線 trip (date-led row identity, diary.spec idiom): zero chips + the hint.
  await page.locator('.trip', { hasText: '2026.02.01' }).getByRole('button', { name: /＋車両/ }).click();
  await expect(page.getByText('この路線の候補は未収録です。自由入力で記録できます。')).toBeVisible();
  await expect(page.locator('.editor-chips')).toHaveCount(0);

  // 山手線 trip: its real stock pads (profile order), and the old CN-first pad is gone.
  await page.locator('.trip', { hasText: '2026.01.15' }).getByRole('button', { name: /＋車両/ }).click();
  const chips = page.locator('.editor-chips');
  await expect(chips.getByRole('button', { name: 'E235系', exact: true })).toBeVisible();
  await expect(chips).not.toContainText('CR400AF');
  // Tapping a gated-in chip still drives the capture loop end to end (DD5 unchanged).
  await chips.getByRole('button', { name: 'E235系', exact: true }).click();
  await expect(page.locator('#dex-edit-input')).toHaveValue('E235系');
});

test('live mark with a new model: first-collect toast (D14) taps through to the sheet (DD4)', async ({ page }) => {
  // Boot with one ride so the map mounts and the mark FAB is reachable (route-picker idiom).
  await page.goto('/?e2e=1');
  await page.waitForFunction(
    async () => (await indexedDB.databases()).some((d) => d.name === 'railprint'),
    null,
    { timeout: 20_000 },
  );
  await seed(page, [
    { id: 't0:' + JP_SEG, segmentId: JP_SEG, railGeoVersion: '2025.2.0', source: 'manual', tripId: 't0', createdAt: '2025-01-01T00:00:00.000Z' },
  ]);
  await page.reload();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => (window as any).__mapReady === true, null, { timeout: 30_000 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window as any).__map?.fire('load'));
  await page.getByRole('button', { name: '区間をマーク' }).first().click();
  await page.getByRole('tab', { name: '駅名で検索' }).click();

  await page.locator('#rp-q-a').fill('津');
  await page.locator('.hit').first().click();
  await page.locator('#rp-q-b').fill('大阪難波');
  await page.locator('.hit').first().click();
  // Select the route into the 経路を確認 panel (a route no longer records on pick), then tag
  // the train inside it and commit with 「この経路で記録」.
  const routeChip = page.locator('.route-chip').first();
  await expect(routeChip).toBeVisible({ timeout: 15_000 });
  await routeChip.click();
  const confirm = page.locator('.route-confirm');
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await page.locator('#rp-train').fill('80000系'); // ひのとり — new to the collection
  await confirm.locator('.route-record').click();

  // D14: the first-collect beat REPLACES the plain coverage toast; undo stays available.
  const collectToast = page.getByText(/80000系を図鑑に追加しました/);
  await expect(collectToast).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeVisible();
  // 6A: crossing 初車両 on a live mark celebrates exactly once.
  await expect(page.getByText(/初車両.*を達成しました/)).toBeVisible({ timeout: 10_000 });

  // DD4: tapping the toast body deep-links to 統計 + opens the sheet AT the new card's detail
  // view — whose dialog accname is the model, not 車両図鑑, so locate generically.
  await collectToast.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await expect(sheet.getByText('ひのとり').first()).toBeVisible(); // 愛称 pills on the detail view
});
