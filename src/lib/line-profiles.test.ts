import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STUB_PACKAGES } from './fallback-package';
import { lineProfile, profiledLineIds, isUbiquitousFold } from './line-profiles';
import { modelByFold } from './train-models';

// line-profiles is CURATED DATA feeding the v3 suggestion gate — these tests are the
// editing gates (same idiom as model-registry.test.ts): a typo'd fold or a lineId that
// drifted out of the rail package must fail CI, not silently un-gate a line.

/** Every lineId a profile may key on: the manifest's shipped packages (so a third
 *  package auto-extends the vocabulary — review finding: don't hardcode the file
 *  list) PLUS the boot-fallback stub lines (profiled so degraded boots keep chips). */
function shippedLineIds(): Set<string> {
  const ids = new Set<string>();
  const manifest = JSON.parse(readFileSync('public/rail/manifest.json', 'utf8')) as {
    packages: Record<string, { path: string }>;
  };
  for (const { path } of Object.values(manifest.packages)) {
    const pkg = JSON.parse(readFileSync(`public/${path}`, 'utf8')) as { lines: { lineId: string }[] };
    for (const l of pkg.lines) ids.add(l.lineId);
  }
  for (const stub of STUB_PACKAGES) for (const l of stub.lines) ids.add(l.lineId);
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

  it('lineProfile of undefined or an unknown lineId is undefined (the no-pads signal)', () => {
    expect(lineProfile(undefined)).toBeUndefined();
    expect(lineProfile('jp-テスト-存在しない線')).toBeUndefined();
  });

  it('ubiquitous flags invert correctly (an editing gate for the ubiquitous: true markers)', () => {
    for (const f of ['キハ40', 'E233', 'E231', 'キハ110']) expect(isUbiquitousFold(f), f).toBe(true);
    for (const f of ['E353', 'N700S', 'CR400AF', '383', '285']) expect(isUbiquitousFold(f), f).toBe(false);
  });

  it('REVERSE gate: every isHSR line in every shipped package HAS a profile', () => {
    // The gate fails CLOSED on an unprofiled HSR line (all registry recents gated, zero
    // pads) — adding a new HSR corridor package without its roster would silently ship a
    // dead capture surface (adversarial-review finding).
    const manifest = JSON.parse(readFileSync('public/rail/manifest.json', 'utf8')) as {
      packages: Record<string, { path: string }>;
    };
    for (const { path } of Object.values(manifest.packages)) {
      const pkg = JSON.parse(readFileSync(`public/${path}`, 'utf8')) as {
        lines: { lineId: string; isHSR: boolean }[];
      };
      for (const l of pkg.lines) {
        if (l.isHSR) expect(lineProfile(l.lineId), `isHSR line ${l.lineId} has no profile`).toBeDefined();
      }
    }
    for (const stub of STUB_PACKAGES) {
      for (const l of stub.lines) {
        if (l.isHSR) expect(lineProfile(l.lineId), `stub isHSR line ${l.lineId} has no profile`).toBeDefined();
      }
    }
  });

  it('every profile fold is an ACTIVE card — a retired model must never become a pad', () => {
    // (Plan-audit residual: E3 is data-absent from every profile today, but only this
    // gate makes that an invariant instead of a coincidence.)
    for (const id of profiledLineIds()) {
      for (const fold of lineProfile(id)!) {
        expect(modelByFold(fold)!.active, `inactive fold "${fold}" in profile of ${id}`).toBe(true);
      }
    }
  });
});
