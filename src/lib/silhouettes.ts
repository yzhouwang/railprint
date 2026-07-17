// D21 stage-2 — per-model RASTER silhouettes (gpt-image-2 先頭 front-crops).
//
// One 512×176 lossless WebP per model in public/silhouettes/<fold>.webp serves BOTH card
// states: collected renders it as an <img>, ghost renders it as a CSS mask
// (`mask: url(...) center / contain no-repeat`) filled with var(--dex-ghost-fill) — the
// DD10 ghost token, never a restyle. Art carries its own livery colors (DD8 livery-is-data
// carve-out); the registry accentColor is NOT applied on top of raster art.
//
// The fold list is pinned to the ACTIVE 新幹線 roster (13 — E3 is inactive and never
// ghost-cards). silhouettes.test.ts enforces list ≡ roster ≡ files on disk + size budget.
import { assetUrl } from './asset-url';

export const SILHOUETTE_FOLDS = [
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
] as const;

const FOLDS: ReadonlySet<string> = new Set(SILHOUETTE_FOLDS);

/** Raster silhouette URL for a fold, or undefined when the model has no per-model art
 *  (category-variant SVG remains the fallback). */
export function silhouetteAsset(fold: string): string | undefined {
  return FOLDS.has(fold) ? assetUrl(`/silhouettes/${fold}.webp`) : undefined;
}
