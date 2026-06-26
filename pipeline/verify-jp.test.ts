import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RailGeoPackage } from '../src/contract/types.ts';
import {
  CURATED_ANCHORS,
  PUBLISHED_KM_TOLERANCE,
  checkCuratedAnchor,
  checkTier0HsrDenominator,
} from './verify-jp-gates.ts';

function loadPackage(): RailGeoPackage {
  return JSON.parse(readFileSync('public/rail/jp-2025.json', 'utf8')) as RailGeoPackage;
}

describe('verify-jp golden gates', () => {
  it('keeps curated published-km anchors within tolerance', () => {
    const pkg = loadPackage();
    const failures = CURATED_ANCHORS
      .map((anchor) => ({ anchor, check: checkCuratedAnchor(pkg, anchor) }))
      .filter(({ check }) => !check.kmOk)
      .map(({ anchor, check }) => `${anchor.name}: ${check.km.toFixed(1)}km (${(check.deviation * 100).toFixed(1)}%)`);

    expect(PUBLISHED_KM_TOLERANCE).toBe(0.12);
    expect(failures).toEqual([]);
  });

  it('checks station-count anchors against the regenerated package', () => {
    const pkg = loadPackage();
    const stationAnchors = CURATED_ANCHORS.filter((anchor) => anchor.stations !== undefined);
    const failures = stationAnchors
      .map((anchor) => ({ anchor, check: checkCuratedAnchor(pkg, anchor) }))
      .filter(({ check }) => !check.stationOk)
      .map(({ anchor, check }) => `${anchor.name}: ${check.stationCount}/${anchor.stations}`);

    expect(stationAnchors.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it('uses the HSR line count as the tier-0 denominator', () => {
    const pkg = loadPackage();
    const gate = checkTier0HsrDenominator(pkg);
    const actualHsrLines = pkg.lines.filter((line) => line.isHSR).length;

    expect(gate.totalLineCount).toBe(pkg.lines.length);
    expect(gate.hsrLineCount).toBe(actualHsrLines);
    expect(gate.tier0Count).toBe(gate.hsrLineCount);
    expect(gate.hsrShare).toBeCloseTo(actualHsrLines / pkg.lines.length, 8);
    expect(gate.ok).toBe(true);
  });
});
