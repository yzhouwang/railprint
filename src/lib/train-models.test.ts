import { describe, it, expect } from 'vitest';
import { canonicalizeTrainModel } from './train-models';

describe('canonicalizeTrainModel', () => {
  it('folds N700S variants to the canonical model token', () => {
    expect(canonicalizeTrainModel('N700S')).toBe('N700S');
    expect(canonicalizeTrainModel('N700s')).toBe('N700S');
    expect(canonicalizeTrainModel('N700-S')).toBe('N700S');
    expect(canonicalizeTrainModel('N700　S')).toBe('N700S');
    expect(canonicalizeTrainModel('N700S系')).toBe('N700S');
  });

  it('returns blank for blank input', () => {
    expect(canonicalizeTrainModel('')).toBe('');
    expect(canonicalizeTrainModel('   ')).toBe('');
  });
});
