// 車両 canonicalization + registry-derived lookups (v0.13 vehicle-dex, plan D2/D4/D9).
//
// ONE definition of model equality lives here (design 5A): every comparison surface —
// capture chips (model-suggest), chip highlight (MapView), diary pills (StatsScreen),
// collection keying (collection.ts), speed lookup (resolver) — routes through
// foldKey()/sameModel(). Stored trainModel strings are NEVER rewritten (plan D4:
// export fidelity + reversibility); ALL folding is read-time.
//
// model-registry.ts is a pure-data module; every derived index (speed table, alias
// index, roster lists) is built HERE so no import cycle can form.

import { MODEL_REGISTRY, type TrainModelInfo } from './model-registry';

/**
 * Fold a raw 車両 string to its canonical comparison token.
 * v2 (plan D9, additive-collapse only): NFKC pre-fold (Ｅ５系 → E5系, full-width digits/
 * letters → ASCII) added IN FRONT of the v1 pipeline; every v1 fold result is unchanged
 * (regression-pinned in train-models.test.ts). Then: trim, drop the word "series", strip
 * ONE trailing 系/形/型, strip spaces (incl. U+3000) / hyphens / underscores, uppercase.
 * Slash strings ('E5/H5') survive verbatim — no auto-pick (plan D9/D13).
 */
export function canonicalizeTrainModel(raw: string): string {
  const trimmed = raw.normalize('NFKC').trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/\bseries\b/giu, '')
    .replace(/[系形型]\s*$/u, '')
    .replace(/[\s　\-_]+/gu, '')
    .toUpperCase();
}

/** The read-time comparison key for a stored/typed 車両 string (design 5A). */
export function foldKey(raw: string | undefined): string {
  return raw === undefined ? '' : canonicalizeTrainModel(raw);
}

/** True when two raw 車両 spellings denote the same model (E5 ≡ e5 ≡ Ｅ５系). */
export function sameModel(a: string | undefined, b: string | undefined): boolean {
  const ka = foldKey(a);
  return ka !== '' && ka === foldKey(b);
}

/**
 * THE collection-identity key (D2, single definition — ship review): the REGISTRY fold when
 * the raw spelling resolves through the fold+alias index (so 'N700系7000番台' and 'レールスター'
 * land on their card), else the raw string's own foldKey (unknown その他 identities).
 * Every surface that keys or compares collection membership — summarizeCollection standings,
 * collectedModelKeys, the first-collect beat, diary pill groups, the sheet's detail filters —
 * MUST route through this one function; hand-recomputing it is how the alias bug class ships.
 */
export function collectionFold(raw: string | undefined): string {
  const k = foldKey(raw);
  if (k === '') return '';
  return byFold.get(k)?.fold ?? k;
}

/**
 * D15 preview helper (shared by the map capture field and the diary editor so the two input
 * surfaces provably behave identically): the canonical token when folding would CHANGE the
 * trimmed input, else null (no preview shown for already-canonical text).
 */
export function foldPreview(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const canon = canonicalizeTrainModel(raw);
  return canon !== trimmed ? canon : null;
}

// ── registry indexes (built once at module init; registry is static data) ──

const byFold = new Map<string, TrainModelInfo>();
for (const info of MODEL_REGISTRY) {
  // fold uniqueness is test-enforced (model-registry.test.ts); first-wins keeps runtime total.
  if (!byFold.has(info.fold)) byFold.set(info.fold, info);
  for (const alias of info.aliases ?? []) {
    const k = canonicalizeTrainModel(alias);
    if (k && !byFold.has(k)) byFold.set(k, info);
  }
}

/** Registry entry for a raw/stored 車両 string via the fold + alias index, else undefined (その他). */
export function resolveModel(raw: string | undefined): TrainModelInfo | undefined {
  const k = foldKey(raw);
  return k === '' ? undefined : byFold.get(k);
}

/** Registry entry by exact fold key (for consumers that already folded). */
export function modelByFold(fold: string): TrainModelInfo | undefined {
  return byFold.get(fold);
}

// ── speed lookup (resolver.ts fastestModel — consumer API unchanged) ──
//
// The v1 hand table conflated "suggestable" with "has a speed". v2 derives speeds from the
// registry, PLUS the legacy speed-only family keys that are not (and should not be) roster
// cards ('CR400' the family, standalone folds users type). The exact 23 v1 keys must keep
// resolving to their v1 values — regression-pinned.

const SPEED_ONLY: Record<string, number> = {
  CR400: 350, // family shorthand — not a card; resolves speed only
};

const TOP_SPEED: Map<string, number> = new Map();
for (const info of MODEL_REGISTRY) {
  if (info.topSpeedKmh !== undefined) TOP_SPEED.set(info.fold, info.topSpeedKmh);
}
for (const [k, v] of Object.entries(SPEED_ONLY)) {
  if (!TOP_SPEED.has(k)) TOP_SPEED.set(k, v);
}

/** Top speed for a logged model, or undefined if unknown. Resolves through the registry
 *  alias index first (ship review: rides logged as 'N700系7000番台'/'レールスター' must carry
 *  their card's speed into the fastest-model pick), then the speed-only family keys. */
export function topSpeedKmh(model: string | undefined): number | undefined {
  if (!model) return undefined;
  const k = foldKey(model);
  return byFold.get(k)?.topSpeedKmh ?? TOP_SPEED.get(k);
}

// ── legacy suggestion list (v1 API kept for compatibility + the chips-migration baseline) ──
//
// v1 exported KNOWN_TRAIN_MODELS = Object.keys(TOP_SPEED_KMH) in declaration order
// (CN CR/CRH families first, then Shinkansen). The chips baseline test pins that padding
// order, so the order is preserved VERBATIM here rather than derived from registry order.
export const KNOWN_TRAIN_MODELS: string[] = [
  'CR400AF', 'CR400BF', 'CR400', 'CR300AF', 'CR300BF', 'CR200J',
  'CRH380A', 'CRH380B', 'CRH2', 'CRH3',
  'E5', 'H5', 'E6', 'E7', 'W7', 'E2', 'E3',
  'N700S', 'N700A', 'N700', '700', '500', '800',
];

export type { TrainModelInfo };
