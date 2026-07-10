import { describe, it, expect } from 'vitest';
import {
  canonicalizeTrainModel,
  foldKey,
  sameModel,
  resolveModel,
  KNOWN_TRAIN_MODELS,
  topSpeedKmh,
} from './train-models';

describe('canonicalizeTrainModel', () => {
  it('folds N700S variants to the canonical model token', () => {
    expect(canonicalizeTrainModel('N700S')).toBe('N700S');
    expect(canonicalizeTrainModel('N700s')).toBe('N700S');
    expect(canonicalizeTrainModel('N700-S')).toBe('N700S');
    expect(canonicalizeTrainModel('N700　S')).toBe('N700S');
    expect(canonicalizeTrainModel('N700S系')).toBe('N700S');
  });

  it('covers every fold branch: case, separators, series word, 系/形/型 suffix', () => {
    expect(canonicalizeTrainModel('cr400af')).toBe('CR400AF'); // pure case-fold
    expect(canonicalizeTrainModel('n700_s')).toBe('N700S'); // underscore separator
    expect(canonicalizeTrainModel('E5 series')).toBe('E5'); // the 'series' word
    expect(canonicalizeTrainModel('E5形')).toBe('E5'); // 形 suffix
    expect(canonicalizeTrainModel('E5型')).toBe('E5'); // 型 suffix
    expect(canonicalizeTrainModel('285系')).toBe('285'); // 系 suffix on a numeric model
  });

  // v2 (plan D9): NFKC pre-fold — full-width input collapses onto the same tokens.
  it('NFKC-folds full-width letters and digits (additive collapse only)', () => {
    expect(canonicalizeTrainModel('Ｅ５系')).toBe('E5');
    expect(canonicalizeTrainModel('ｎ７００Ｓ')).toBe('N700S');
    expect(canonicalizeTrainModel('ＣＲ４００ＡＦ')).toBe('CR400AF');
    // カタカナ形式名は NFKC で不変 (half-width kana would widen, never the reverse split)
    expect(canonicalizeTrainModel('キハE130系')).toBe('キハE130');
  });

  it('leaves slash strings verbatim — no auto-pick of a pair (plan D9/D13)', () => {
    expect(canonicalizeTrainModel('E5/H5')).toBe('E5/H5');
    expect(resolveModel('E5/H5')).toBeUndefined();
  });

  it('returns blank for blank input', () => {
    expect(canonicalizeTrainModel('')).toBe('');
    expect(canonicalizeTrainModel('   ')).toBe('');
  });
});

describe('foldKey / sameModel (the ONE definition of model equality, design 5A)', () => {
  it('treats spelling variants as the same model', () => {
    expect(sameModel('E5', 'e5系')).toBe(true);
    expect(sameModel('E5系', 'Ｅ５')).toBe(true);
    expect(sameModel('N700-S', 'N700S系')).toBe(true);
  });

  it('never equates distinct models or blanks', () => {
    expect(sameModel('E5', 'H5')).toBe(false);
    expect(sameModel('', '')).toBe(false);
    expect(sameModel(undefined, undefined)).toBe(false);
    expect(sameModel('E5', undefined)).toBe(false);
  });

  it('foldKey of undefined is the empty string', () => {
    expect(foldKey(undefined)).toBe('');
  });
});

describe('resolveModel (registry fold + alias index)', () => {
  it('resolves canonical folds and spelling variants to registry entries', () => {
    expect(resolveModel('E5系')?.id).toBe('jp-jre-e5');
    expect(resolveModel('e5')?.id).toBe('jp-jre-e5');
    expect(resolveModel('CR400AF')?.id).toBe('cn-cr-cr400af');
  });

  it('resolves declared aliases (番台 folds up to its 形式, plan D2)', () => {
    expect(resolveModel('N700系7000番台')?.id).toBe('jp-jrw-n700');
    expect(resolveModel('GV-E400')?.id).toBe('jp-jre-gve400');
  });

  it('does NOT resolve 愛称 — nicknames are candidate-set data, never aliases (plan D9/D13)', () => {
    expect(resolveModel('ひのとり')).toBeUndefined();
    expect(resolveModel('のぞみ')).toBeUndefined();
    expect(resolveModel('ラピート')).toBeUndefined();
  });

  it('returns undefined for unknown free text (その他 bucket keeps it verbatim)', () => {
    expect(resolveModel('おもちゃ')).toBeUndefined();
    expect(resolveModel(undefined)).toBeUndefined();
  });
});

describe('KNOWN_TRAIN_MODELS (legacy chips-padding source — order is the pinned baseline)', () => {
  it('is non-empty, blank-free, and already in canonical form (idempotent)', () => {
    expect(KNOWN_TRAIN_MODELS.length).toBeGreaterThan(0);
    expect(KNOWN_TRAIN_MODELS.every((m) => m.length > 0)).toBe(true);
    expect(KNOWN_TRAIN_MODELS.every((m) => canonicalizeTrainModel(m) === m)).toBe(true);
  });

  it('preserves the exact v1 key list and order (chips-migration regression baseline, 9A#4)', () => {
    expect(KNOWN_TRAIN_MODELS).toEqual([
      'CR400AF', 'CR400BF', 'CR400', 'CR300AF', 'CR300BF', 'CR200J',
      'CRH380A', 'CRH380B', 'CRH2', 'CRH3',
      'E5', 'H5', 'E6', 'E7', 'W7', 'E2', 'E3',
      'N700S', 'N700A', 'N700', '700', '500', '800',
    ]);
  });
});

describe('topSpeedKmh', () => {
  it('resolves a known model (incl. a variant) and is undefined for unknowns', () => {
    expect(topSpeedKmh('N700A')).toBeGreaterThan(0);
    expect(topSpeedKmh('n700-a')).toBe(topSpeedKmh('N700A')); // variant folds to the same speed
    expect(topSpeedKmh('まったく未知の車両')).toBeUndefined();
    expect(topSpeedKmh(undefined)).toBeUndefined();
  });

  // CRITICAL regression pin (plan T1): the registry refactor must reproduce every v1
  // (key → speed) pair — CONSCIOUS exceptions only. 2026-07 fact-check correction: the v1
  // table understated the N700 family (285 was the 東海道-only ceiling; regular 山陽 service
  // is 300 km/h) — those three values are deliberately corrected here, everything else exact.
  it('reproduces the 23 legacy speed entries (N700 family consciously corrected to 300)', () => {
    const V1: Record<string, number> = {
      CR400AF: 350, CR400BF: 350, CR400: 350, CR300AF: 250, CR300BF: 250, CR200J: 160,
      CRH380A: 350, CRH380B: 350, CRH2: 250, CRH3: 350,
      E5: 320, H5: 320, E6: 320, E7: 260, W7: 260, E2: 275, E3: 275,
      N700S: 300, N700A: 300, N700: 300, 700: 285, 500: 285, 800: 260,
    };
    for (const [key, speed] of Object.entries(V1)) {
      expect(topSpeedKmh(key), `speed of ${key}`).toBe(speed);
    }
  });

  it('knows E8 (missing from v1 — in service since 2024)', () => {
    expect(topSpeedKmh('E8系')).toBe(300);
  });
});
