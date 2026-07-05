import { describe, it, expect } from 'vitest';
import { normalizeBasemap, BASEMAP_ATTRIBUTION } from './basemap';

describe('normalizeBasemap — vendored style validation + required attribution', () => {
  const valid = {
    sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [{ id: 'background', type: 'background' }],
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
  };

  it('passes a valid style through with glyphs + sprite', () => {
    const out = normalizeBasemap(valid)!;
    expect(out.layers).toHaveLength(1);
    expect(out.glyphs).toBe(valid.glyphs);
    expect(out.sprite).toBe(valid.sprite);
  });

  it('stamps the REQUIRED OSM attribution onto sources that carry none (the vendored positron has none)', () => {
    const out = normalizeBasemap(valid)!;
    expect(out.sources.openmaptiles.attribution).toBe(BASEMAP_ATTRIBUTION);
  });

  it('preserves an existing source attribution instead of overwriting it', () => {
    const out = normalizeBasemap({
      ...valid,
      sources: { x: { type: 'raster', attribution: '© Somebody' } },
    })!;
    expect(out.sources.x.attribution).toBe('© Somebody');
  });

  it('rejects malformed shapes (null on failure → map boots basemap-less, never throws)', () => {
    expect(normalizeBasemap(null)).toBeNull();
    expect(normalizeBasemap('nope')).toBeNull();
    expect(normalizeBasemap({ sources: {} })).toBeNull(); // layers missing
    expect(normalizeBasemap({ layers: [] })).toBeNull(); // sources missing
  });

  it('omits glyphs/sprite keys entirely when absent (MapLibre rejects undefined)', () => {
    const out = normalizeBasemap({ sources: {}, layers: [] })!;
    expect('glyphs' in out).toBe(false);
    expect('sprite' in out).toBe(false);
  });
});

describe('the vendored positron.json itself', () => {
  it('normalizes cleanly: sources + layers + glyphs + sprite all present', async () => {
    const { readFileSync } = await import('node:fs');
    const raw = JSON.parse(readFileSync('public/basemap/positron.json', 'utf8'));
    const out = normalizeBasemap(raw);
    expect(out).not.toBeNull();
    expect(out!.layers.length).toBeGreaterThan(30);
    expect(out!.glyphs).toContain('tiles.openfreemap.org');
    expect(Object.values(out!.sources).every((s) => typeof s.attribution === 'string')).toBe(true);
  });
});
