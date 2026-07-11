import { describe, it, expect } from 'vitest';
import {
  MODEL_REGISTRY,
  CATEGORY_LABELS,
  ROSTER_BASIS_YEAR,
  type TrainModelInfo,
} from './model-registry';
import { canonicalizeTrainModel } from './train-models';

// Registry content gates (plan T1 + review 14A). These pins are DELIBERATE (D6 honest
// denominators): a roster edit must consciously update the counts here, in the sheet
// meters, and in the CHANGELOG — never drift silently.

describe('MODEL_REGISTRY identity rules (plan D2)', () => {
  it('ids are unique and operator-scoped (jp-*/cn-* prefix)', () => {
    const ids = MODEL_REGISTRY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^(jp|cn)-[a-z0-9]+-[a-z0-9]+$/.test(id))).toBe(true);
  });

  it('folds + aliases are collision-free across the whole roster (v0.13 MUST hold)', () => {
    const seen = new Map<string, string>(); // fold key -> id that claimed it
    for (const m of MODEL_REGISTRY) {
      for (const key of [m.fold, ...(m.aliases ?? []).map((a) => canonicalizeTrainModel(a))]) {
        expect(seen.get(key), `fold "${key}" claimed by both ${seen.get(key)} and ${m.id}`).toBeUndefined();
        seen.set(key, m.id);
      }
    }
  });

  it('every fold IS the canonical fold of its own display name (self-consistent)', () => {
    for (const m of MODEL_REGISTRY) {
      expect(canonicalizeTrainModel(m.name), `${m.id} name→fold`).toBe(m.fold);
    }
  });

  it('pair links are symmetric and point at real entries (E5↔H5, E7↔W7)', () => {
    const byId = new Map(MODEL_REGISTRY.map((m) => [m.id, m]));
    for (const m of MODEL_REGISTRY) {
      if (!m.pairId) continue;
      const pair = byId.get(m.pairId);
      expect(pair, `${m.id} pairId target`).toBeDefined();
      expect(pair!.pairId).toBe(m.id);
    }
  });
});

describe('MODEL_REGISTRY roster pins (D6 honest denominators)', () => {
  it('active 新幹線 roster = 13 (10A pairs separate; E2 RESTORED by the 2026-03 改正 fact-check; E3 retired)', () => {
    const active = MODEL_REGISTRY.filter((m) => m.category === 'shinkansen' && m.active);
    expect(active.map((m) => m.fold).sort()).toEqual(
      ['500', '700', '800', 'E2', 'E5', 'E6', 'E7', 'E8', 'H5', 'N700', 'N700A', 'N700S', 'W7'].sort(),
    );
    const inactive = MODEL_REGISTRY.filter((m) => m.category === 'shinkansen' && !m.active);
    expect(inactive.map((m) => m.fold).sort()).toEqual(['E3']);
  });

  it('京沪 corridor roster = 4, all CN + active (11B; CRH380A left the line per the 2026 fact-check)', () => {
    const corridor = MODEL_REGISTRY.filter((m) => m.corridor === 'jinghu');
    expect(corridor.map((m) => m.fold).sort()).toEqual(['CR400AF', 'CR400BF', 'CRH380B', 'CRH380C']);
    expect(corridor.every((m) => m.country === 'CN' && m.active)).toBe(true);
  });

  it('roster size stays in the curated band (~150-200; re-pinned for the 2026-07-11 full-roster expansion)', () => {
    // Deliberate re-pin (knob≠constant rule): the original ~50-70 band was plan 15A's launch
    // scope; the expansion sweep grew the roster to the full active universe (166 entries).
    expect(MODEL_REGISTRY.length).toBeGreaterThanOrEqual(150);
    expect(MODEL_REGISTRY.length).toBeLessThanOrEqual(200);
  });
});

describe('MODEL_REGISTRY field discipline', () => {
  const isEntrySane = (m: TrainModelInfo): void => {
    expect(m.source.length, `${m.id} provenance (14A)`).toBeGreaterThan(4);
    expect(['JP', 'CN']).toContain(m.country);
    expect(Object.keys(CATEGORY_LABELS)).toContain(m.category);
    expect(['shinkansen', 'cn-hsr', 'express', 'commuter', 'dmu']).toContain(m.silhouette);
    if (m.accentColor) expect(m.accentColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    if (m.topSpeedKmh !== undefined) {
      expect(m.topSpeedKmh).toBeGreaterThan(0);
      expect(m.topSpeedKmh).toBeLessThanOrEqual(400);
    }
    expect(m.name.length).toBeGreaterThan(0);
  };

  it('every entry carries provenance, valid country/category/silhouette, sane colors + speeds', () => {
    for (const m of MODEL_REGISTRY) isEntrySane(m);
  });

  it('CN entries are cn-hsr, JP entries never are (per-country separation feeds D6 meters)', () => {
    for (const m of MODEL_REGISTRY) {
      expect(m.category === 'cn-hsr', `${m.id} category/country`).toBe(m.country === 'CN');
    }
  });

  it('retiring stock carries honest urgency, never invented rarity (D6)', () => {
    const gohyaku = MODEL_REGISTRY.find((m) => m.id === 'jp-jrw-500');
    expect(gohyaku?.retiresNote).toContain('2027');
    expect(gohyaku?.active).toBe(true); // still earnable until it actually retires
  });

  it('roster basis year is stamped for the sheet footer', () => {
    expect(ROSTER_BASIS_YEAR).toBe(2026);
  });
});
