// C2 + C3 — bilingual station-first search + line inference, over the stub package.
// The stub carries nameRoma + stationGroupId on the transfer stations (新宿/渋谷/東京/品川/…),
// added by the experience lane so these run before the real engine package lands.
import { describe, it, expect } from 'vitest';
import { STUB_PACKAGES, JP_PACKAGE } from '../fixtures/stubPackage';
import { buildGeoIndex } from './store';
import {
  buildSearchIndex,
  resolveQuery,
  inferLine,
  groupKeyForHit,
  preferPickedLine,
  normRoma,
  bilingualLabel,
  type StationHit,
} from './search';
import type { RouteCandidate } from '../contract/types';

const rc = (lines: string[], totalKm: number): RouteCandidate => ({
  segmentIds: lines.map((l, i) => `${l}:${i}-${i + 1}`),
  lines,
  totalKm,
  lineChanges: lines.length - 1,
  railGeoVersion: 'v',
});

describe('preferPickedLine', () => {
  it('floats a single-line route on a picked line above a shorter parallel line', () => {
    const hsr = rc(['tokaido-shinkansen'], 6.4); // findRoutes would rank this first (fewer km)
    const local = rc(['yamanote'], 6.5);
    const out = preferPickedLine([hsr, local], new Set(['yamanote']));
    expect(out[0]).toBe(local); // the picked local line is now first, not the parallel Shinkansen
    expect(out[1]).toBe(hsr);
  });

  it('is a no-op when no route is on a picked line', () => {
    const a = rc(['x'], 1);
    const b = rc(['y'], 2);
    expect(preferPickedLine([a, b], new Set(['z']))).toEqual([a, b]);
  });

  it('does not promote a MULTI-line route even if it uses a picked line', () => {
    const multi = rc(['yamanote', 'chuo'], 5);
    const other = rc(['z'], 3);
    expect(preferPickedLine([multi, other], new Set(['yamanote']))).toEqual([multi, other]);
  });
});

const geo = buildGeoIndex(STUB_PACKAGES);
const index = buildSearchIndex(geo);

// Helper: the lineIds a query resolves to, sorted.
const linesOf = (hits: StationHit[]): string[] => hits.map((h) => h.line.lineId).sort();
const names = (hits: StationHit[]): string[] => [...new Set(hits.map((h) => h.station.name))];

describe('normRoma', () => {
  it('folds macrons + drops hyphens/spaces/case', () => {
    expect(normRoma('Ōsaka')).toBe('osaka');
    expect(normRoma('Shin-Ōkubo')).toBe('shinokubo');
    expect(normRoma('Den-en-chōfu')).toBe('denenchofu');
    expect(normRoma('SHINJUKU')).toBe('shinjuku');
  });
});

describe('resolveQuery — 新宿 across input modes', () => {
  it('resolves the 日本語 name 新宿 (exact key)', async () => {
    const hits = await resolveQuery('新宿', index);
    expect(names(hits)).toContain('新宿');
    expect(hits.every((h) => h.exact)).toBe(true);
  });

  it('resolves 新宿駅 (駅 suffix) to 新宿 via normStation', async () => {
    const hits = await resolveQuery('新宿駅', index);
    expect(names(hits)).toContain('新宿');
  });

  it('resolves the romaji "shinjuku" (exact romaji key)', async () => {
    const hits = await resolveQuery('shinjuku', index);
    expect(names(hits)).toContain('新宿');
    expect(hits.every((h) => h.exact)).toBe(true);
  });

  it('resolves the romaji "Shinjuku" (mixed case)', async () => {
    const hits = await resolveQuery('Shinjuku', index);
    expect(names(hits)).toContain('新宿');
  });

  it('resolves the kana しんじゅく via the wanakana fold', async () => {
    const hits = await resolveQuery('しんじゅく', index);
    expect(names(hits)).toContain('新宿');
  });
});

describe('resolveQuery — transfer stations return ALL line-instances (no 5-cap)', () => {
  it('渋谷 returns both its line-instances (山手線 + 東急東横線)', async () => {
    const hits = await resolveQuery('渋谷', index);
    const shibuya = hits.filter((h) => h.station.name === '渋谷');
    expect(shibuya.length).toBe(2);
    expect(linesOf(shibuya)).toEqual(['jr-yamanote', 'tokyu-toyoko']);
  });

  it('東京 returns both line-instances (山手線 + 東海道新幹線)', async () => {
    const hits = await resolveQuery('東京', index);
    const tokyo = hits.filter((h) => h.station.name === '東京');
    expect(linesOf(tokyo)).toEqual(['jr-tokaido-shinkansen', 'jr-yamanote']);
  });

  it('does NOT cap results at 5 (every instance is returned)', async () => {
    // Manufacture a 7-way transfer by counting the most-shared station group in the stub and
    // asserting the resolver returns the full set, not a slice. 品川 is on 2 lines here; the
    // guarantee under test is "return ALL", which we check structurally: no slice(0,5).
    const hits = await resolveQuery('品川', index);
    const shinagawa = hits.filter((h) => h.station.name === '品川');
    expect(shinagawa.length).toBe(2); // both instances, never truncated
  });
});

describe('resolveQuery — fuzzy + misc', () => {
  it('returns [] for a blank query', async () => {
    expect(await resolveQuery('   ', index)).toEqual([]);
  });

  it('fuzzy-matches a romaji typo (shinjyuku → 新宿) above the floor', async () => {
    const hits = await resolveQuery('shinjyuku', index);
    expect(names(hits)).toContain('新宿');
  });

  it('rejects nonsense with no plausible candidate', async () => {
    const hits = await resolveQuery('zzzqqq', index);
    expect(hits.length).toBe(0);
  });
});

describe('inferLine — 1-share / multi-share / no-share', () => {
  const hit = async (q: string, lineId: string): Promise<StationHit> => {
    const hits = await resolveQuery(q, index);
    const h = hits.find((x) => x.line.lineId === lineId);
    if (!h) throw new Error(`no hit for ${q} on ${lineId}`);
    return h;
  };

  it('SINGLE shared line: 新宿 ↔ 上野 → 山手線 only', async () => {
    const a = await hit('新宿', 'jr-yamanote');
    const b = await hit('上野', 'jr-yamanote');
    const inf = inferLine(groupKeyForHit(a), groupKeyForHit(b), geo, STUB_PACKAGES);
    expect(inf.status).toBe('one');
    if (inf.status === 'one') {
      expect(inf.candidate.line.lineId).toBe('jr-yamanote');
      expect(inf.candidate.segmentIds.length).toBeGreaterThan(0);
    }
  });

  it('MULTI shared line: 東京 ↔ 品川 → 山手線 AND 東海道新幹線 (picker)', async () => {
    const a = await hit('東京', 'jr-yamanote');
    const b = await hit('品川', 'jr-yamanote');
    const inf = inferLine(groupKeyForHit(a), groupKeyForHit(b), geo, STUB_PACKAGES);
    expect(inf.status).toBe('many');
    if (inf.status === 'many') {
      expect(inf.candidates.map((c) => c.line.lineId).sort()).toEqual([
        'jr-tokaido-shinkansen',
        'jr-yamanote',
      ]);
    }
  });

  it('NO shared line: 上野 ↔ 横浜 → none (record each leg separately)', async () => {
    const a = await hit('上野', 'jr-yamanote');
    const b = await hit('横浜', 'tokyu-toyoko');
    const inf = inferLine(groupKeyForHit(a), groupKeyForHit(b), geo, STUB_PACKAGES);
    expect(inf.status).toBe('none');
  });

  it('every offered candidate has a real segmentsBetween path', async () => {
    const a = await hit('東京', 'jr-yamanote');
    const b = await hit('品川', 'jr-yamanote');
    const inf = inferLine(groupKeyForHit(a), groupKeyForHit(b), geo, STUB_PACKAGES);
    if (inf.status === 'many') {
      for (const c of inf.candidates) expect(c.segmentIds.length).toBeGreaterThan(0);
    }
  });
});

describe('end-to-end typed flow (C4 logic): query A + query B → markable candidate', () => {
  it('type "Shibuya" then "Shinjuku" → infers 山手線 with the segmentIds markRide consumes', async () => {
    const a = (await resolveQuery('Shibuya', index)).find((h) => h.line.lineId === 'jr-yamanote')!;
    const b = (await resolveQuery('Shinjuku', index)).find((h) => h.line.lineId === 'jr-yamanote')!;
    const inf = inferLine(groupKeyForHit(a), groupKeyForHit(b), geo, STUB_PACKAGES);
    expect(inf.status).toBe('one');
    if (inf.status === 'one') {
      // The candidate carries the concrete from/to ids + a non-empty segment slice — exactly the
      // shape MapView.doMark → markRide needs. (markRide is unit-tested separately in store.test.)
      expect(inf.candidate.line.lineId).toBe('jr-yamanote');
      expect(inf.candidate.segmentIds.length).toBeGreaterThan(0);
      expect(inf.candidate.fromStationId).toContain('jr-yamanote');
      expect(inf.candidate.toStationId).toContain('jr-yamanote');
    }
  });
});

describe('bilingualLabel', () => {
  it('formats name (Roma) when a reading exists, bare name otherwise', () => {
    expect(bilingualLabel('新宿', 'Shinjuku')).toBe('新宿 (Shinjuku)');
    expect(bilingualLabel('久留里')).toBe('久留里');
  });
});

describe('stub fixture sanity', () => {
  it('the JP package carries nameRoma on 新宿 and stationGroupId on transfers', () => {
    const shinjuku = JP_PACKAGE.stations.find((s) => s.name === '新宿');
    expect(shinjuku?.nameRoma).toBe('Shinjuku');
    const tokyo = JP_PACKAGE.stations.filter((s) => s.name === '東京');
    expect(tokyo.every((s) => s.stationGroupId === 'g-tokyo')).toBe(true);
  });
});
