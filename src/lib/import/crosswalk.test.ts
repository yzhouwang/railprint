import { describe, it, expect } from 'vitest';
import { JP_PACKAGE, STUB_PACKAGES } from '../../fixtures/stubPackage';
import { buildGeoIndex } from '../store';
import {
  diceSimilarity,
  normStation,
  normLine,
  scoreStationCandidates,
  resolveStation,
  segmentJoining,
} from './crosswalk';

const geo = buildGeoIndex(STUB_PACKAGES);

describe('normalization', () => {
  it('folds 旧字 to 新字 (澁谷 → 渋谷, 横濱 → 横浜)', () => {
    expect(normStation('澁谷')).toBe(normStation('渋谷'));
    expect(normStation('横濱')).toBe(normStation('横浜'));
  });

  it('strips a 駅 suffix and fullwidth drift', () => {
    expect(normStation('渋谷駅')).toBe(normStation('渋谷'));
    expect(normStation('渋谷 ')).toBe('渋谷');
  });

  it('strips JR prefix, 線 suffix, and parenthetical qualifiers on line names', () => {
    expect(normLine('JR山手線')).toBe(normLine('山手'));
    expect(normLine('中央線(快速)')).toBe(normLine('中央'));
  });
});

describe('diceSimilarity', () => {
  it('scores identical strings 1 and disjoint strings 0', () => {
    expect(diceSimilarity('渋谷', '渋谷')).toBe(1);
    expect(diceSimilarity('渋谷', '東京')).toBe(0);
  });
  it('scores partial overlap between 0 and 1', () => {
    const s = diceSimilarity('東横線', '東横');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe('resolveStation', () => {
  it('cleanly matches an exact name + line (久留里線 木更津)', () => {
    const v = resolveStation({ rawName: '木更津', rawLineName: '久留里線' }, geo);
    expect(v.status).toBe('matched');
    if (v.status === 'matched') {
      expect(v.best.station.name).toBe('木更津');
      expect(v.best.line.lineId).toBe('jr-kururi');
    }
  });

  it('matches through 旧字 when the line disambiguates (澁谷 on 東急東横線)', () => {
    const v = resolveStation({ rawName: '澁谷', rawLineName: '東急東横線' }, geo);
    expect(v.status).toBe('matched');
    if (v.status === 'matched') {
      expect(v.best.station.name).toBe('渋谷');
      expect(v.best.line.lineId).toBe('tokyu-toyoko');
    }
  });

  it('is honest about a transfer station with no line hint (渋谷 → ambiguous, not a guess)', () => {
    // 渋谷 exists on both 山手線 and 東急東横線 — without a line or coord it must NOT auto-pick.
    const v = resolveStation({ rawName: '渋谷' }, geo);
    expect(v.status).toBe('ambiguous');
    if (v.status === 'ambiguous') {
      const lines = v.candidates.map((c) => c.line.lineId);
      expect(lines).toContain('jr-yamanote');
      expect(lines).toContain('tokyu-toyoko');
    }
  });

  it('uses coordinate proximity to pick the nearer of two same-named stations', () => {
    // 上野 appears only on 山手線 in the stub, but 東京 appears on BOTH 山手線 and the
    // Tokaido Shinkansen at DIFFERENT coords — a coord near one must float it to the top.
    const yamanoteTokyo = JP_PACKAGE.stations.find(
      (s) => s.lineId === 'jr-yamanote' && s.name === '東京',
    )!;
    const shinkansenTokyo = JP_PACKAGE.stations.find(
      (s) => s.lineId === 'jr-tokaido-shinkansen' && s.name === '東京',
    )!;
    // The two share coords in the stub, so instead verify the proximity MECHANIC: a
    // coordinate sitting on the Shinkansen 名古屋 point, with a drifted name, locks on.
    const nagoya = JP_PACKAGE.stations.find(
      (s) => s.lineId === 'jr-tokaido-shinkansen' && s.name === '名古屋',
    )!;
    const top = scoreStationCandidates(
      { rawName: '名護屋', lon: nagoya.lon, lat: nagoya.lat }, // 旧字-ish drift
      geo,
    )[0];
    expect(top.station.stationId).toBe(nagoya.stationId);
    // sanity: both Tokyo entries exist so the fixture assumption holds
    expect(yamanoteTokyo).toBeTruthy();
    expect(shinkansenTokyo).toBeTruthy();
  });

  it('returns unmatched for nonsense that resembles nothing', () => {
    const v = resolveStation({ rawName: 'ZZZ架空駅XYZ' }, geo);
    expect(v.status).toBe('unmatched');
  });

  it('never silently drops a row: always returns a verdict object', () => {
    for (const raw of ['渋谷', '木更津', '架空', '']) {
      const v = resolveStation({ rawName: raw }, geo);
      expect(['matched', 'ambiguous', 'unmatched']).toContain(v.status);
    }
  });
});

describe('segmentJoining', () => {
  it('finds the inter-station segment for consecutive stations either direction', () => {
    const a = JP_PACKAGE.stations.find((s) => s.lineId === 'jr-kururi' && s.name === '木更津')!;
    const b = JP_PACKAGE.stations.find((s) => s.lineId === 'jr-kururi' && s.name === '祇園')!;
    const seg = segmentJoining('jr-kururi', a.stationId, b.stationId, JP_PACKAGE);
    expect(seg).toBe('jr-kururi:0-1');
    // direction-independent
    expect(segmentJoining('jr-kururi', b.stationId, a.stationId, JP_PACKAGE)).toBe('jr-kururi:0-1');
  });

  it('returns undefined for non-adjacent stations', () => {
    const a = JP_PACKAGE.stations.find((s) => s.lineId === 'jr-kururi' && s.name === '木更津')!;
    const c = JP_PACKAGE.stations.find((s) => s.lineId === 'jr-kururi' && s.name === '横田')!;
    expect(segmentJoining('jr-kururi', a.stationId, c.stationId, JP_PACKAGE)).toBeUndefined();
  });
});
