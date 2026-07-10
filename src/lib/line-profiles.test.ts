import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lineProfile, profiledLineIds, isUbiquitousFold } from './line-profiles';
import { modelByFold } from './train-models';

// line-profiles is CURATED DATA feeding the v3 suggestion gate — these tests are the
// editing gates (same idiom as model-registry.test.ts): a typo'd fold or a lineId that
// drifted out of the rail package must fail CI, not silently un-gate a line.

/** Every lineId in the shipped packages (the profile keys' only legal vocabulary). */
function shippedLineIds(): Set<string> {
  const ids = new Set<string>();
  for (const file of ['public/rail/jp-2025.json', 'public/rail/cn-jinghu-2025.json']) {
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { lines: { lineId: string }[] };
    for (const l of pkg.lines) ids.add(l.lineId);
  }
  return ids;
}

describe('line-profiles — structural gates', () => {
  it('every profiled lineId exists in a shipped rail package', () => {
    const shipped = shippedLineIds();
    const strays = profiledLineIds().filter((id) => !shipped.has(id));
    expect(strays).toEqual([]);
  });

  it('every profile fold resolves to a registry CARD by its own fold key (no aliases, no strays)', () => {
    for (const id of profiledLineIds()) {
      for (const fold of lineProfile(id)!) {
        const card = modelByFold(fold);
        expect(card, `profile fold "${fold}" on ${id} has no registry card`).toBeDefined();
        // Profiles must store the CARD fold, not an alias — pads key {#each} blocks on it.
        expect(card!.fold, `profile fold "${fold}" on ${id} is an alias of ${card!.fold}`).toBe(fold);
      }
    }
  });

  it('no profile lists a fold twice (pad order is a user-visible contract)', () => {
    for (const id of profiledLineIds()) {
      const folds = lineProfile(id)!;
      expect(new Set(folds).size, `duplicate fold in profile of ${id}`).toBe(folds.length);
    }
  });

  it('country coherence: jp- lines hold JP cards, cn- lines hold CN cards', () => {
    for (const id of profiledLineIds()) {
      const want = id.startsWith('cn-') ? 'CN' : 'JP';
      for (const fold of lineProfile(id)!) {
        expect(modelByFold(fold)!.country, `${fold} on ${id}`).toBe(want);
      }
    }
  });

  it('the 京沪 profile equals the registry corridor set (one source of truth, two spellings)', () => {
    expect(lineProfile('cn-中国铁路-京沪高速铁路')).toEqual(['CR400AF', 'CR400BF', 'CRH380B', 'CRH380C']);
  });

  it('mini-shinkansen hosts carry their through-runners (the false-negative the gate must never ship)', () => {
    expect(lineProfile('jp-東日本旅客鉄道-田沢湖線')).toContain('E6');
    expect(lineProfile('jp-東日本旅客鉄道-奥羽線')).toEqual(expect.arrayContaining(['E6', 'E8']));
    expect(lineProfile('jp-北海道旅客鉄道-海峡線')).toEqual(expect.arrayContaining(['E5', 'H5']));
    expect(lineProfile('jp-西日本旅客鉄道-博多南線')).toContain('500');
  });

  it('every ubiquitous fold is a registry card', () => {
    // (Set may be empty until the conventional data block lands — the shape must still hold.)
    for (const id of profiledLineIds()) {
      for (const fold of lineProfile(id)!) {
        if (isUbiquitousFold(fold)) expect(modelByFold(fold)).toBeDefined();
      }
    }
  });
});
