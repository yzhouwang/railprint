import { test, expect, type Page } from '@playwright/test';

// Cross-line route marking, end to end: search 津 → 大阪難波 (特急ひのとり spans 名古屋線→大阪線→難波線)
// and confirm the route-picker surfaces a multi-line route that single-line marking could never reach.
// Uses the same headless-WebGL harness as map-lod.spec.ts.

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
          segmentId: 'jp-東日本旅客鉄道-山手線:004095-004135',
          railGeoVersion: '2025.2.0',
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

  // Tapping a route now SELECTS it into the 経路を確認 panel — it no longer records instantly.
  await routeChip.click();
  const confirm = page.locator('.route-confirm');
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  // 「この経路で記録」 is what commits; the success toast confirms the cross-line ride landed.
  await confirm.locator('.route-record').click();
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

test('captures the train model on a recorded route and surfaces it in the diary', async ({ page }) => {
  await enterSearchMode(page);
  await page.locator('#rp-q-a').fill('津');
  await page.locator('.hit').first().click();
  await page.locator('#rp-q-b').fill('大阪難波');
  await page.locator('.hit').first().click();

  // Select the route first — the 車両 field now lives INSIDE the confirm panel, scoped to
  // THIS route's lines (名古屋線∩大阪線∩難波線), so the recommendation can inform the pick.
  const routeChip = page.locator('.route-chip').first();
  await expect(routeChip).toBeVisible({ timeout: 15_000 });
  await routeChip.click();
  const confirm = page.locator('.route-confirm');
  await expect(confirm).toBeVisible({ timeout: 10_000 });

  // Through-service recommendation: 80000系 (ひのとり) — the fold in the intersection of the
  // three 近鉄 lines this route rides — leads the suggestion pads.
  await expect(confirm.locator('.train-chips button').first()).toHaveText('80000系');

  // Free text stays first-class: tag a model the pads don't offer (T2 capture path).
  await page.locator('#rp-train').fill('N700S');
  await confirm.locator('.route-record').click();
  // v0.13 D14: a mark that collects a NEW model replaces the plain coverage toast with the
  // first-collect beat (undo stays as the action) — this used to assert 経路を記録しました.
  await expect(page.getByText(/N700Sを図鑑に追加しました/)).toBeVisible({ timeout: 10_000 });

  // The captured model rides through to the diary row on 統計.
  await page.getByRole('button', { name: /統計/ }).first().click();
  await expect(page.getByText('N700S').first()).toBeVisible({ timeout: 15_000 });

  // The diary endpoints must be the TRUE cross-line origin/destination (group-aware), not a
  // mid-route leg — if endpoint detection fell back to the longest leg, 大阪難波 would not show.
  const route = page.locator('.trip-route').first();
  await expect(route).toContainText('大阪難波');
  await expect(route).toContainText('津');
});

test('shinkansen through-route: 長野 → 金沢 recommends the 北陸 through-stock E7系/W7系 first', async ({ page }) => {
  // The feature's flagship: a route spanning TWO 北陸新幹線 legs — 東日本 (長野→上越妙高) then
  // 西日本 (上越妙高→金沢), split at the JR East/West boundary. No parallel conventional line
  // matches its 1-change directness, so the 北陸新幹線 route is the おすすめ. The 車両 chips are
  // the fold intersection across the two legs — the through-capable 北陸 stock (E7系 then W7系),
  // which every かがやき/はくたか actually runs. (長野 vs 大宮/東京: from 大宮 the 大宮→高崎 leg
  // ties the shinkansen with conventional 高崎線 and wins on km → E233; from 東京 the fewest-
  // change route is the 東海道→米原→北陸線 detour → N700A. 長野→金沢 has no such shorter tie.)
  await enterSearchMode(page);

  // 長野's 新幹線 instance is the 北陸新幹線 platform (the others are 長野電鉄 / しなの鉄道).
  // 金沢's two instances (北陸新幹線 / IRいしかわ) share one group; filter the same way.
  await page.locator('#rp-q-a').fill('長野');
  await page.locator('.hit', { hasText: '新幹線' }).first().click();
  await page.locator('#rp-q-b').fill('金沢');
  await page.locator('.hit', { hasText: '新幹線' }).first().click();

  // Single- or multi-candidate — handle both: the confirm panel appears directly for a lone
  // route; otherwise the picker shows and its first (recommended) chip selects into it.
  const confirm = page.locator('.route-confirm');
  const routeChip = page.locator('.route-chip').first();
  await expect(confirm.or(routeChip)).toBeVisible({ timeout: 15_000 });
  if (!(await confirm.isVisible())) await routeChip.click();
  await expect(confirm).toBeVisible({ timeout: 10_000 });

  // The non-negotiable assertion: E7系 then W7系 lead the route-scoped 車両 pads.
  const chips = confirm.locator('.train-chips button');
  await expect(chips.nth(0)).toHaveText('E7系');
  await expect(chips.nth(1)).toHaveText('W7系');

  // And the confirm → record path still lands a trip.
  await confirm.locator('.route-record').click();
  await expect(page.getByText(/経路を記録しました|図鑑に追加/)).toBeVisible({ timeout: 10_000 });
});
