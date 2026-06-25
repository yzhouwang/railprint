import { describe, it, expect } from 'vitest';
import { canonicalizeTrainModel, KNOWN_TRAIN_MODELS, topSpeedKmh } from './train-models';

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

  it('returns blank for blank input', () => {
    expect(canonicalizeTrainModel('')).toBe('');
    expect(canonicalizeTrainModel('   ')).toBe('');
  });
});

describe('KNOWN_TRAIN_MODELS', () => {
  it('is non-empty, blank-free, and already in canonical form (idempotent)', () => {
    expect(KNOWN_TRAIN_MODELS.length).toBeGreaterThan(0);
    expect(KNOWN_TRAIN_MODELS.every((m) => m.length > 0)).toBe(true);
    // every suggestion is its own canonical token — feeding it back changes nothing
    expect(KNOWN_TRAIN_MODELS.every((m) => canonicalizeTrainModel(m) === m)).toBe(true);
  });
});

describe('topSpeedKmh', () => {
  it('resolves a known model (incl. a variant) and is undefined for unknowns', () => {
    expect(topSpeedKmh('N700A')).toBeGreaterThan(0);
    expect(topSpeedKmh('n700-a')).toBe(topSpeedKmh('N700A')); // variant folds to the same speed
    expect(topSpeedKmh('まったく未知の車両')).toBeUndefined();
    expect(topSpeedKmh(undefined)).toBeUndefined();
  });
});
