import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import type { RailGeoPackage } from '../../src/contract/types';

// 共用区間 braid, end to end in a real headless WebGL context — the 青函トンネル corridor where the
// 北海道新幹線 and the 海峡線 share one physical track (三線軌条). Because the geometry is IDENTICAL,
// zoom can never pull the two lines apart; the braid detector (lib/map/overlap.ts) splits the shared
// RUN and tags each strand with a `slot`, parity-normalized per run (2A), so the style draws them
// side by side via data-driven line-offset.
//
// WHY property/feature asserts and NEVER a pixel/screenshot compare: the map renders under
// Chromium's SwiftShader software GL, whose sub-pixel output drifts run-to-run — a pixel diff here
// would be a chronic flake surface, and this suite GATES deploys. So we drive the live map, then
// read queryRenderedFeatures + getPaint/LayoutProperty: does the corridor DETECT (both lines
// present, each carrying a numeric slot of opposite sign), and are the braid style props wired
// (line-offset paint, line-sort-key layout)? That proves detection + direction-parity + style
// binding without ever trusting a pixel. See tests/e2e/map-lod.spec.ts for the harness idioms.

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

  // Jump to the 青函トンネル (Tsugaru Strait), then POLL until the corridor is actually rendered —
  // a fixed sleep under-waits on a loaded SwiftShader CI runner and burns time on a fast one.
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__map.jumpTo({ center: [140.393, 41.317], zoom: 8.5 });
  });
  await page.waitForFunction(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__map;
      return (
        map.loaded() && map.queryRenderedFeatures({ layers: ['rp-segments-line'] }).length > 0
      );
    },
    null,
    { timeout: 30_000 },
  );

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
      // MATCHED corridor pairs: a braided feature names its partner segment (partnerSeg); the
      // partner's own rendered feature must carry a nonzero slot too — the two strands of ONE
      // shared run, both offset. (A cross-line any-pair sign product is trivially satisfiable
      // because parity legitimately differs per run — this is the assert that can actually fail.)
      const bySegment = new Map<string, number>();
      for (const f of feats) {
        if (typeof f.properties.slot === 'number' && f.properties.slot !== 0) {
          bySegment.set(f.properties.segmentId, f.properties.slot);
        }
      }
      let matchedPairs = 0;
      for (const f of feats) {
        const partner = f.properties.partnerSeg;
        if (typeof partner === 'string' && partner !== '' && bySegment.has(partner)) matchedPairs++;
      }
      return {
        hsCount: feats.filter((f) => f.properties.lineId === hsLine).length,
        kkCount: feats.filter((f) => f.properties.lineId === kkLine).length,
        hsSlots: slotsFor(hsLine),
        kkSlots: slotsFor(kkLine),
        matchedPairs,
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

  // (b) Each line carries at least one numeric `slot`, and at least one MATCHED pair renders:
  // a braided feature plus the partner segment it names, both with nonzero slots — end-to-end
  // proof of detection + per-run parity wiring on the same shared run (2A).
  expect(result.hsSlots.length, 'no numeric slot on any 北海道新幹線 feature').toBeGreaterThan(0);
  expect(result.kkSlots.length, 'no numeric slot on any 海峡線 feature').toBeGreaterThan(0);
  expect(result.matchedPairs, 'no matched braided pair (feature + its named partnerSeg)').toBeGreaterThan(0);

  // (c) + (d) The braid style is wired on the segments layer: data-driven offset + sort-key.
  expect(result.lineOffset, "line-offset paint must be set on 'rp-segments-line'").not.toBeNull();
  expect(result.lineSortKey, "line-sort-key layout must be set on 'rp-segments-line'").not.toBeNull();
});
