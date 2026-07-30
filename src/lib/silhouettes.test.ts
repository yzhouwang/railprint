import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL_REGISTRY } from './model-registry';
import { modelByFold } from './train-models';
import { SILHOUETTE_BATCHES, SILHOUETTE_FOLDS, silhouetteAsset } from './silhouettes';

// silhouettes.ts fronts CURATED ART ASSETS (public/silhouettes/<fold>.webp) feeding
// TrainSilhouette's raster branch — these are the editing gates (registry idiom): a
// typo'd fold, a missing/oversized asset, or a fold outside its category batch
// must fail CI, not silently ghost a card's art or blow the precache budget.

const ASSET_DIR = join(__dirname, '../../public/silhouettes');
const MAX_ASSET_BYTES = 80 * 1024; // lossless 512×176 WebP lands ~30-40KB
const MAX_TOTAL_BYTES = 2 * 1024 * 1024; // 37 lossless WebPs are ~1.3MB in the precache

describe('silhouettes — raster asset gates', () => {
  it('every silhouette fold is a registry CARD (own fold key, not an alias)', () => {
    for (const fold of SILHOUETTE_FOLDS) {
      const card = modelByFold(fold);
      expect(card, `silhouette fold "${fold}" has no registry card`).toBeDefined();
      expect(card!.fold, `silhouette fold "${fold}" is an alias of ${card!.fold}`).toBe(fold);
      expect(card!.active, `silhouette fold "${fold}" is inactive`).toBe(true);
    }
  });

  it('the batch covers EXACTLY the active 新幹線 roster (13/13, no strays)', () => {
    const active = MODEL_REGISTRY.filter((m) => m.category === 'shinkansen' && m.active)
      .map((m) => m.fold)
      .sort();
    expect([...SILHOUETTE_BATCHES.shinkansen].sort()).toEqual(active);
  });

  // Iterates the BATCH ENTRIES (key = registry category), so a future batch key
  // (commuter, dmu, cn-hsr) inherits its category gate automatically — a per-key
  // hardcoded gate was the reviewed trap (a third batch would ship ungated).
  it('every batch fold carries its batch key as its registry category', () => {
    for (const [category, folds] of Object.entries(SILHOUETTE_BATCHES)) {
      for (const fold of folds) {
        expect(modelByFold(fold)?.category, `fold "${fold}" is not a ${category} card`).toBe(
          category,
        );
      }
    }
  });

  // The subset batch has no roster to pin against, so pin its CARDINALITY: without this,
  // deleting folds + their files keeps every other gate green (codex adversarial P1 —
  // "remove 23 of 24 assets with green CI"). Update DELIBERATELY when a batch lands.
  it('the ltd-express batch holds exactly the shipped 24 (accidental deletions must be loud)', () => {
    expect(SILHOUETTE_BATCHES['ltd-express']).toHaveLength(24);
  });

  it('has no duplicate folds across batches', () => {
    expect(SILHOUETTE_FOLDS).toHaveLength(new Set(SILHOUETTE_FOLDS).size);
  });

  // the workbox glob precaches every .webp in the directory, so a stray/orphan file
  // would ship into the precache uncounted — gate strays in both directions
  it('the asset directory holds EXACTLY the batch files', () => {
    const onDisk = readdirSync(ASSET_DIR)
      .filter((f) => f.endsWith('.webp'))
      // NFC insurance: APFS may hand back decomposed (NFD) names for future folds with
      // voiced kana (ダ/ガ…); the registry folds are NFC. Today's CJK folds are
      // normalization-invariant — this keeps the gate honest when one isn't.
      .map((f) => f.normalize('NFC'))
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
      // truncation floor: a bare RIFF header would pass the magic check (codex adversarial)
      expect(size, `${fold}.webp is implausibly small — truncated?`).toBeGreaterThanOrEqual(10 * 1024);
      const head = readFileSync(path).subarray(0, 32);
      expect(head.toString('latin1', 0, 4), `${fold}.webp is not RIFF`).toBe('RIFF');
      expect(head.toString('latin1', 8, 12), `${fold}.webp is not WEBP`).toBe('WEBP');
      // VP8L (lossless) headers carry the canvas size — assert the pipeline contract
      // 512×176 without a decoder: 0x2F signature, then 14-bit (w-1), 14-bit (h-1).
      expect(head.toString('latin1', 12, 16), `${fold}.webp is not lossless VP8L`).toBe('VP8L');
      expect(head[20], `${fold}.webp bad VP8L signature`).toBe(0x2f);
      const bits = head[21] | (head[22] << 8) | (head[23] << 16) | (head[24] << 24);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      expect({ width, height }, `${fold}.webp wrong canvas`).toEqual({ width: 512, height: 176 });
      // the ghost CSS mask is alpha-mode — an asset without alpha paints a SOLID rectangle
      expect((bits >>> 28) & 1, `${fold}.webp has no alpha channel`).toBe(1);
    }
    expect(total, 'silhouette set exceeds precache budget').toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });

  it('silhouetteAsset() resolves batch folds and returns undefined for the rest', () => {
    expect(silhouetteAsset('E5')).toMatch(/silhouettes\/E5\.webp$/);
    expect(silhouetteAsset('E353')).toMatch(/silhouettes\/E353\.webp$/);
    expect(silhouetteAsset('E3')).toBeUndefined(); // inactive — never ghost-cards
    expect(silhouetteAsset('E257')).toBeUndefined(); // registry 特急 card — not in the batch
    expect(silhouetteAsset('CR400AF')).toBeUndefined();
  });

  it('silhouetteAsset() prefixes the injected base — the GitHub-Pages subpath 404 class', () => {
    expect(silhouetteAsset('E5', '/railprint/')).toBe('/railprint/silhouettes/E5.webp');
    expect(silhouetteAsset('E5', '/')).toBe('/silhouettes/E5.webp');
    // CJK folds resolve through the same template — the URL half of the filename gate
    expect(silhouetteAsset('キハ261')).toMatch(/silhouettes\/キハ261\.webp$/);
    expect(silhouetteAsset('南海50000', '/railprint/')).toBe('/railprint/silhouettes/南海50000.webp');
  });
});
