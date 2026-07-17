import { describe, expect, it } from 'vitest';
import { SILHOUETTE_SPECS, silhouetteSpec } from './silhouette-specs';
import { MODEL_REGISTRY } from './model-registry';
import { modelByFold } from './train-models';

// silhouette-specs is CURATED ART DATA feeding TrainSilhouette's D21 branch — these are
// the editing gates (registry idiom): a typo'd fold, a band outside the 100×52 box, or a
// missing spec for an active Shinkansen must fail CI, not silently ghost a card's art.

describe('SILHOUETTE_SPECS — structural gates', () => {
  it('every spec fold is a registry CARD (own fold key, not an alias)', () => {
    for (const fold of Object.keys(SILHOUETTE_SPECS)) {
      const card = modelByFold(fold);
      expect(card, `spec fold "${fold}" has no registry card`).toBeDefined();
      expect(card!.fold, `spec fold "${fold}" is an alias of ${card!.fold}`).toBe(fold);
    }
  });

  it('the first batch covers EXACTLY the active 新幹線 roster (13/13, no strays)', () => {
    const active = MODEL_REGISTRY.filter((m) => m.category === 'shinkansen' && m.active)
      .map((m) => m.fold)
      .sort();
    expect(Object.keys(SILHOUETTE_SPECS).sort()).toEqual(active);
  });

  it('body/cab paths are well-formed closed-ish SVG path strings', () => {
    for (const [fold, s] of Object.entries(SILHOUETTE_SPECS)) {
      expect(s.body, fold).toMatch(/^M[\d .]/);
      expect(s.body.trim().endsWith('Z'), `${fold} body not closed`).toBe(true);
      expect(s.cab, fold).toMatch(/^M[\d .]/);
    }
  });

  it('bands stay inside the 100×52 box and use 6-digit hex colors (DD8 carve-out is data)', () => {
    for (const [fold, s] of Object.entries(SILHOUETTE_SPECS)) {
      for (const b of s.bands ?? []) {
        expect(b.y, fold).toBeGreaterThanOrEqual(0);
        expect(b.y + b.h, fold).toBeLessThanOrEqual(52);
        expect(b.color, fold).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it('window rows and wheels stay inside the box (windows never overrun the nose tip)', () => {
    for (const [fold, s] of Object.entries(SILHOUETTE_SPECS)) {
      const w = s.windows;
      expect(w.count, fold).toBeGreaterThanOrEqual(3);
      expect(w.x + (w.count - 1) * w.pitch + w.w, `${fold} windows overrun`).toBeLessThanOrEqual(66);
      expect(w.y + w.h, fold).toBeLessThanOrEqual(45);
      const [a, b] = s.wheels;
      expect(a, fold).toBeGreaterThan(6);
      expect(b, fold).toBeLessThan(90);
      expect(b, fold).toBeGreaterThan(a);
    }
  });

  it('silhouetteSpec() resolves specs and returns undefined for non-batch folds', () => {
    expect(silhouetteSpec('E5')).toBeDefined();
    expect(silhouetteSpec('E353')).toBeUndefined(); // 特急 — later batch
    expect(silhouetteSpec('CR400AF')).toBeUndefined();
  });
});
