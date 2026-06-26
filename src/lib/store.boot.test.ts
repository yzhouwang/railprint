// Boot-path tests for init()'s package fetch + fallback (codex #8 regression). init() is
// idempotent via a module-level flag, so each case gets a FRESH store module via
// vi.resetModules() + dynamic import, with global fetch stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import type { RailGeoPackage } from '../contract/types';

const realPkg: RailGeoPackage = {
  version: '2025.1.0', generatedAt: 't', crs: 'WGS84', country: 'JP',
  lines: [{ lineId: 'x', name: 'X', country: 'JP', isHSR: false, isLoop: false, stationOrder: ['x:a'], geometry: { type: 'LineString', coordinates: [[139, 35], [139.1, 35]] } }],
  segments: [{ segmentId: 'x:0-1', lineId: 'x', fromStationId: 'x:a', toStationId: 'x:b', fromSeq: 0, toSeq: 1, km: 5, isHSR: false, geometry: { type: 'LineString', coordinates: [[139, 35], [139.1, 35]] } }],
  stations: [],
};

const cnPkg: RailGeoPackage = {
  version: '2025.1.0', generatedAt: 't', crs: 'WGS84', country: 'CN',
  lines: [{ lineId: 'cn-x', name: '京沪', country: 'CN', isHSR: true, isLoop: false, stationOrder: ['cn-x:a'], geometry: { type: 'LineString', coordinates: [[116, 39], [121, 31]] } }],
  segments: [{ segmentId: 'cn-x:0-1', lineId: 'cn-x', fromStationId: 'cn-x:a', toStationId: 'cn-x:b', fromSeq: 0, toSeq: 1, km: 1300, isHSR: true, geometry: { type: 'LineString', coordinates: [[116, 39], [121, 31]] } }],
  stations: [],
};

describe('init() package fetch + fallback', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('loads the real package when the fetch succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => realPkg })));
    const store = await import('./store');
    await store.init();
    expect(get(store.ready)).toBe(true);
    expect(get(store.usingFallback)).toBe(false);
    expect(get(store.packages)[0]?.version).toBe('2025.1.0');
  });

  it('REGRESSION: a failed fetch falls back to the stub, app still boots, usingFallback flagged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const store = await import('./store');
    await store.init();
    expect(get(store.ready)).toBe(true); // the app must NOT hang on a blank screen
    expect(get(store.usingFallback)).toBe(true);
    expect(get(store.packages).length).toBeGreaterThan(0); // stub loaded
  });

  it('falls back when the fetched package is malformed/empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ lines: [], segments: [] }) })));
    const store = await import('./store');
    await store.init();
    expect(get(store.usingFallback)).toBe(true);
  });

  it('falls back on a non-OK HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const store = await import('./store');
    await store.init();
    expect(get(store.usingFallback)).toBe(true);
  });

  it('retries the real package on `online` and self-heals (codex#8 recovery path)', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('first boot offline');
      return { ok: true, json: async () => realPkg };
    }));
    const store = await import('./store');
    await store.init();
    expect(get(store.usingFallback)).toBe(true); // fell back on first boot
    window.dispatchEvent(new Event('online')); // connection returns
    await vi.waitFor(() => expect(get(store.usingFallback)).toBe(false));
    expect(get(store.packages)[0]?.version).toBe('2025.1.0'); // real package swapped in
  });

  it('dataDegraded is true ONLY on fallback AND with saved events (not silent 0%)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('x'); }));
    const store = await import('./store');
    await store.clearAllRides();
    await store.init();
    expect(get(store.dataDegraded)).toBe(false); // on fallback but no rides → not "degraded"
    await store.addEvents([{ id: 'e1', segmentId: 's', railGeoVersion: 'v', source: 'manual', createdAt: 't' }]);
    expect(get(store.dataDegraded)).toBe(true); // rides exist but won't resolve against stub
    await store.clearAllRides();
  });

  it('loads JP + the CN corridor when both fetch cleanly', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => (url.includes('cn') ? cnPkg : realPkg) })));
    const store = await import('./store');
    await store.init();
    expect(get(store.packages).map((p) => p.country).sort()).toEqual(['CN', 'JP']);
  });

  it('REJECTS a wrong-country payload — a CN url serving a JP package never loads as CN', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => realPkg }))); // JP for BOTH urls
    const store = await import('./store');
    await store.init();
    const pkgs = get(store.packages);
    expect(pkgs.every((p) => p.country === 'JP')).toBe(true); // the CN-url JP payload was rejected
    expect(pkgs).toHaveLength(1); // JP only — no second, mis-namespaced package
  });

  it('NO fake-CN fallback: a JP failure boots JP-only, never a stub CN package', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const store = await import('./store');
    await store.init();
    expect(get(store.usingFallback)).toBe(true);
    expect(get(store.packages).some((p) => p.country === 'CN')).toBe(false); // no fake CN ids to record against
  });
});
