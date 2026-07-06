import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import type { RailGeoPackage } from '../../src/contract/types';

// 共用区間 braid, end to end in a real headless WebGL context — the 青函トンネル corridor where the
// 北海道新幹線 and the 海峡線 share one physical track (三線軌条). Because the geometry is IDENTICAL,
// zoom can never pull the two lines apart; the braid detector (lib/map/overlap.ts) splits the shared
// RUN and tags each strand with a `slot` so the style draws them side by side via data-driven
// line-offset, in OPPOSITE parity directions (2A — the two lines traverse the tunnel head-to-tail).
//
// WHY property/feature asserts and NEVER a pixel/screenshot compare: the map renders under
// Chromium's SwiftShader software GL, whose sub-pixel output drifts run-to-run — a pixel diff here
// would be a chronic flake surface, and this suite GATES deploys. So we drive the live map, then
// read queryRenderedFeatures + getPaint/LayoutProperty: does the corridor DETECT (both lines
// present, each carrying a numeric slot of opposite sign), and are the braid style props wired
// (line-offset paint, line-sort-key layout)? That proves detection + direction-parity + style
// binding without ever trusting a pixel. See tests/e2e/map-lod.spec.ts for the harness idioms.
//
// PRE-INTEGRATION: computeOverlapPlan is a skeleton returning an empty Map (the detector lands in a
// parallel lane), so buildSegmentCollection emits no `slot` and no offset props yet — this spec is
// EXPECTED to fail until the detector integrates, at which point CI gates it.

const HOKKAIDO_SHINKANSEN = 'jp-北海道旅客鉄道-北海道新幹線';
const KAIKYO = 'jp-北海道旅客鉄道-海峡線';

// Read the real package at spec load (Node context) exactly like the app ships it, and collect the
// 海峡線 segment ids to seed. Seeding the 海峡線 keeps it visible at z8.5 regardless of its LOD tier
// (ridden ⇒ always-on); the 北海道新幹線 shows anyway via its rank-0 minz. The braid itself is
// data-driven (geometry, not ridden state), so both strands carry slots either way.
const jpPackage = JSON.parse(readFileSync('public/rail/jp-2025.json', 'utf8')) as RailGeoPackage;
const KAIKYO_SEGMENTS = jpPackage.segments
  .filter((seg) => seg.lineId === KAIKYO)
  .map((seg) => seg.segmentId);

// The DB name 'railprint', the store 'rideEvents', and the record shape mirror src/lib/db.ts
// (Dexie can't run inside page.evaluate) — the same hand-mirrored seed the other specs use.
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
    { ids: KAIKYO_SEGMENTS, version: jpPackage.version },
  );
}

// The CI sandbox has no internet; serve a blank 1×1 PNG for the OSM raster so the map loads exactly
// as in production. The assertions only ever touch the local rail (GeoJSON) layers.
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ contentType: 'image/png', body: BLANK_PNG }),
  );
});

test('青函 braid: the 北海道新幹線↔海峡線 shared tunnel renders both strands with opposite-sign slots + wired offset', async ({
  page,
}) => {
  // First load creates the empty IndexedDB (empty-state overlay); seed the 海峡線, then reload so the
  // app boots WITH rides and the map actually mounts.
  await page.goto('/?e2e=1');
  await page.waitForFunction(
    async () => (await indexedDB.databases()).some((d) => d.name === 'railprint'),
    null,
    { timeout: 20_000 },
  );
  await seedRides(page);
  await page.reload();
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__mapReady === true,
    null,
    { timeout: 30_000 },
  );

  // Jump to the 青函トンネル (Tsugaru Strait) and let the rail layers repaint for the new viewport.
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__map.jumpTo({ center: [140.393, 41.317], zoom: 8.5 });
  });
  await page.waitForTimeout(2500);

  const result = await page.evaluate(
    ({ hsLine, kkLine }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__map;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feats = map.queryRenderedFeatures({ layers: ['rp-segments-line'] }) as any[];
      const slotsFor = (lineId: string): number[] =>
        feats
          .filter((f) => f.properties.lineId === lineId)
          .map((f) => f.properties.slot)
          .filter((s): s is number => typeof s === 'number' && Number.isFinite(s));
      return {
        hsCount: feats.filter((f) => f.properties.lineId === hsLine).length,
        kkCount: feats.filter((f) => f.properties.lineId === kkLine).length,
        hsSlots: slotsFor(hsLine),
        kkSlots: slotsFor(kkLine),
        // ?? null so an UNSET property (undefined) becomes null and the non-null assert fails loudly.
        lineOffset: map.getPaintProperty('rp-segments-line', 'line-offset') ?? null,
        lineSortKey: map.getLayoutProperty('rp-segments-line', 'line-sort-key') ?? null,
      };
    },
    { hsLine: HOKKAIDO_SHINKANSEN, kkLine: KAIKYO },
  );

  // (a) BOTH lines of the shared corridor are rendered in the viewport.
  expect(result.hsCount, 'no 北海道新幹線 features in the 青函 viewport').toBeGreaterThan(0);
  expect(result.kkCount, 'no 海峡線 features in the 青函 viewport').toBeGreaterThan(0);

  // (b) Each line carries at least one numeric `slot`, and there exists a cross-line pair whose
  // slots have OPPOSITE signs — end-to-end proof of detection + direction-parity (2A).
  expect(result.hsSlots.length, 'no numeric slot on any 北海道新幹線 feature').toBeGreaterThan(0);
  expect(result.kkSlots.length, 'no numeric slot on any 海峡線 feature').toBeGreaterThan(0);
  const oppositeSigns = result.hsSlots.some((a) => result.kkSlots.some((b) => a * b < 0));
  expect(oppositeSigns, 'no opposite-sign slot pair across 北海道新幹線 and 海峡線').toBe(true);

  // (c) + (d) The braid style is wired on the segments layer: data-driven offset + sort-key.
  expect(result.lineOffset, "line-offset paint must be set on 'rp-segments-line'").not.toBeNull();
  expect(result.lineSortKey, "line-sort-key layout must be set on 'rp-segments-line'").not.toBeNull();
});
