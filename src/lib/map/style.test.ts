import { describe, it, expect } from 'vitest';
import { buildBaseStyle } from './style';
import { STUB_PACKAGES } from '../../fixtures/stubPackage';

describe('buildBaseStyle', () => {
  it('does NOT carry a glyphs:undefined key (MapLibre rejects it and blanks the map)', () => {
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [] });
    // The key must be ABSENT, not present-with-undefined. MapLibre's validator emits
    // "glyphs: string expected, undefined found" and fires map 'error' before 'load',
    // leaving the map stuck blank. (Regression: that shipped in cycle 2.)
    expect('glyphs' in style).toBe(false);
    expect('sprite' in style).toBe(false);
  });

  it('is a self-contained v8 style: geojson sources only, at least one layer', () => {
    const style = buildBaseStyle({ packages: STUB_PACKAGES, litSegmentIds: [] });
    expect(style.version).toBe(8);
    const sources = style.sources as Record<string, { type: string }>;
    expect(Object.values(sources).every((s) => s.type === 'geojson')).toBe(true);
    expect((style.layers as unknown[]).length).toBeGreaterThan(0);
  });
});
