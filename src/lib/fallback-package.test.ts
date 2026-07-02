import { describe, it, expect } from 'vitest';
import { JP_PACKAGE, CN_PACKAGE, STUB_PACKAGES } from './fallback-package';
import type { RailGeoPackage } from '../contract/types';

function checkPackage(pkg: RailGeoPackage): void {
  it(`${pkg.country} package is WGS84 with stable metadata`, () => {
    expect(pkg.crs).toBe('WGS84');
    expect(pkg.version).toMatch(/\d/);
    expect(pkg.lines.length).toBeGreaterThan(0);
  });

  it(`${pkg.country} segmentIds follow the canonical \`lineId:fromSeq-toSeq\` form`, () => {
    for (const seg of pkg.segments) {
      expect(seg.segmentId).toBe(`${seg.lineId}:${seg.fromSeq}-${seg.toSeq}`);
      expect(seg.km).toBeGreaterThan(0);
    }
  });

  it(`${pkg.country} segment counts match the loop/non-loop station structure`, () => {
    for (const line of pkg.lines) {
      const segs = pkg.segments.filter((s) => s.lineId === line.lineId);
      const stations = pkg.stations.filter((s) => s.lineId === line.lineId);
      expect(segs.length).toBe(line.isLoop ? stations.length : stations.length - 1);
      if (line.isLoop) {
        for (const s of segs) expect(s.arcDirection).toBeDefined();
      }
    }
  });

  it(`${pkg.country} station seqs are dense and ordered per line`, () => {
    for (const line of pkg.lines) {
      const seqs = pkg.stations
        .filter((s) => s.lineId === line.lineId)
        .map((s) => s.seq)
        .sort((a, b) => a - b);
      expect(seqs).toEqual(seqs.map((_, i) => i));
      expect(line.stationOrder.length).toBe(seqs.length);
    }
  });
}

describe('stub RailGeoPackage integrity', () => {
  checkPackage(JP_PACKAGE);
  checkPackage(CN_PACKAGE);

  it('exposes JP then CN', () => {
    expect(STUB_PACKAGES.map((p) => p.country)).toEqual(['JP', 'CN']);
  });

  it('marks only the Shinkansen / HSR corridors as HSR', () => {
    const hsrLines = [...JP_PACKAGE.lines, ...CN_PACKAGE.lines].filter((l) => l.isHSR).map((l) => l.lineId);
    expect(hsrLines.sort()).toEqual(['cn-jinghu-hsr', 'jr-tokaido-shinkansen']);
  });

  it('models 山手線 as a closed loop with a plausible total length', () => {
    const loop = JP_PACKAGE.lines.find((l) => l.lineId === 'jr-yamanote')!;
    expect(loop.isLoop).toBe(true);
    const km = JP_PACKAGE.segments
      .filter((s) => s.lineId === 'jr-yamanote')
      .reduce((sum, s) => sum + s.km, 0);
    expect(km).toBeGreaterThan(28);
    expect(km).toBeLessThan(45);
  });
});
