import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL_REGISTRY } from './model-registry';
import { modelByFold } from './train-models';
import { SILHOUETTE_FOLDS, silhouetteAsset } from './silhouettes';

// silhouettes.ts fronts CURATED ART ASSETS (public/silhouettes/<fold>.webp) feeding
// TrainSilhouette's raster branch — these are the editing gates (registry idiom): a
// typo'd fold, a missing/oversized asset, or a fold outside the active 新幹線 roster
// must fail CI, not silently ghost a card's art or blow the precache budget.

const ASSET_DIR = join(__dirname, '../../public/silhouettes');
const MAX_ASSET_BYTES = 80 * 1024; // lossless 512×176 WebP lands ~30-40KB
const MAX_TOTAL_BYTES = 900 * 1024; // all assets precache (workbox glob) — keep it modest

describe('silhouettes — raster asset gates', () => {
  it('every silhouette fold is a registry CARD (own fold key, not an alias)', () => {
    for (const fold of SILHOUETTE_FOLDS) {
      const card = modelByFold(fold);
      expect(card, `silhouette fold "${fold}" has no registry card`).toBeDefined();
      expect(card!.fold, `silhouette fold "${fold}" is an alias of ${card!.fold}`).toBe(fold);
    }
  });

  it('the batch covers EXACTLY the active 新幹線 roster (13/13, no strays)', () => {
    const active = MODEL_REGISTRY.filter((m) => m.category === 'shinkansen' && m.active)
      .map((m) => m.fold)
      .sort();
    expect([...SILHOUETTE_FOLDS].sort()).toEqual(active);
  });

  // the workbox glob precaches every .webp in the directory, so a stray/orphan file
  // would ship into the precache uncounted — gate strays in both directions
  it('the asset directory holds EXACTLY the batch files', () => {
    const onDisk = readdirSync(ASSET_DIR)
      .filter((f) => f.endsWith('.webp'))
      .sort();
    expect(onDisk).toEqual([...SILHOUETTE_FOLDS].map((f) => `${f}.webp`).sort());
  });

  it('every fold has a real WebP on disk, within the per-asset size budget', () => {
    let total = 0;
    for (const fold of SILHOUETTE_FOLDS) {
      const path = join(ASSET_DIR, `${fold}.webp`);
      const size = statSync(path).size; // throws → missing asset fails the test with the path
      total += size;
      expect(size, `${fold}.webp exceeds per-asset budget`).toBeLessThanOrEqual(MAX_ASSET_BYTES);
      const head = readFileSync(path).subarray(0, 16);
      expect(head.toString('latin1', 0, 4), `${fold}.webp is not RIFF`).toBe('RIFF');
      expect(head.toString('latin1', 8, 12), `${fold}.webp is not WEBP`).toBe('WEBP');
    }
    expect(total, 'silhouette set exceeds precache budget').toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });

  it('silhouetteAsset() resolves batch folds and returns undefined for the rest', () => {
    expect(silhouetteAsset('E5')).toMatch(/silhouettes\/E5\.webp$/);
    expect(silhouetteAsset('E3')).toBeUndefined(); // inactive — never ghost-cards
    expect(silhouetteAsset('E353')).toBeUndefined(); // 特急 — later batch
    expect(silhouetteAsset('CR400AF')).toBeUndefined();
  });

  it('silhouetteAsset() prefixes the injected base — the GitHub-Pages subpath 404 class', () => {
    expect(silhouetteAsset('E5', '/railprint/')).toBe('/railprint/silhouettes/E5.webp');
    expect(silhouetteAsset('E5', '/')).toBe('/silhouettes/E5.webp');
  });
});
