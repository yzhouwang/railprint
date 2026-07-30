// D21 stage-2 — per-model RASTER silhouettes (gpt-image-2 先頭 front-crops).
//
// One 512×176 lossless WebP per model in public/silhouettes/<fold>.webp serves BOTH card
// states: collected renders it as an <img>, ghost renders it as a CSS mask
// (`mask: url(...) center / contain no-repeat`) filled with var(--dex-ghost-fill) — the
// DD10 ghost token, never a restyle. Art carries its own livery colors (DD8 livery-is-data
// carve-out); the registry accentColor is NOT applied on top of raster art.
//
// Batches are category-structured: shinkansen is the COMPLETE active roster (pinned);
// ltd-express is a CURATED flagship subset that grows batch by batch.
// silhouettes.test.ts enforces batches ≡ files on disk + size budget.
import { assetUrl } from './asset-url';

export const SILHOUETTE_BATCHES = {
  shinkansen: [
    'N700S',
    'N700A',
    'N700',
    '500',
    '700',
    '800',
    'E5',
    'H5',
    'E6',
    'E7',
    'W7',
    'E8',
    'E2',
  ],
  'ltd-express': [
    'E353',
    'E259',
    'E657',
    'E261',
    '683',
    '273',
    '283',
    '285',
    '787',
    '883',
    '885',
    '789',
    'キハ261',
    '2700',
    '80000',
    '50000',
    '近鉄21000',
    '南海50000',
    'AE',
    'N100',
    '001',
    '70000',
    '東武100',
    '2000',
  ],
} as const;

// DERIVED, never hand-spread: a batch key added above contributes automatically — the
// review trap was a third batch silently contributing nothing until the dir-equality
// gate failed with a confusing "stray file" error. Keys are registry categories; the
// tests iterate the entries, so every future batch inherits its category gate for free.
export const SILHOUETTE_FOLDS: readonly string[] = Object.values(SILHOUETTE_BATCHES).flat();

const FOLDS: ReadonlySet<string> = new Set(SILHOUETTE_FOLDS);

/** Raster silhouette URL for a fold, or undefined when the model has no per-model art
 *  (category-variant SVG remains the fallback). `base` is injectable for tests only —
 *  the asset-url.ts idiom — so subpath hosting (/railprint/) stays gate-testable. */
export function silhouetteAsset(fold: string, base?: string): string | undefined {
  // an undefined base falls through to assetUrl's default (import.meta.env.BASE_URL)
  return FOLDS.has(fold) ? assetUrl(`/silhouettes/${fold}.webp`, base) : undefined;
}
