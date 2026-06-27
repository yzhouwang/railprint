import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import type { RailGeoPackage } from '../contract/types';

const OLD_SEG = 'jp-main:segA1';
const MID_SEG = 'jp-main:segA2';
const NEW_SEG = 'jp-main:segA3';
const STEP_A_PATH = 'rail/migrations/jp/2025.1.0-to-2025.2.0.json';
const STEP_B_PATH = 'rail/migrations/jp/2025.2.0-to-2025.3.0.json';

const jpPkg2025_3: RailGeoPackage = {
  version: '2025.3.0',
  generatedAt: 't',
  crs: 'WGS84',
  country: 'JP',
  lines: [{
    lineId: 'jp-main',
    name: 'JP Main',
    country: 'JP',
    isHSR: false,
    isLoop: false,
    stationOrder: ['jp-main:a', 'jp-main:b'],
    geometry: { type: 'LineString', coordinates: [[139, 35], [139.1, 35]] },
  }],
  segments: [{
    segmentId: NEW_SEG,
    lineId: 'jp-main',
    fromStationId: 'jp-main:a',
    toStationId: 'jp-main:b',
    fromSeq: 0,
    toSeq: 1,
    km: 5,
    isHSR: false,
    geometry: { type: 'LineString', coordinates: [[139, 35], [139.1, 35]] },
  }],
  stations: [],
};

const cnPkg: RailGeoPackage = {
  version: '2025.1.0',
  generatedAt: 't',
  crs: 'WGS84',
  country: 'CN',
  lines: [{
    lineId: 'cn-main',
    name: 'CN Main',
    country: 'CN',
    isHSR: true,
    isLoop: false,
    stationOrder: ['cn-main:a', 'cn-main:b'],
    geometry: { type: 'LineString', coordinates: [[116, 39], [121, 31]] },
  }],
  segments: [{
    segmentId: 'cn-main:0-1',
    lineId: 'cn-main',
    fromStationId: 'cn-main:a',
    toStationId: 'cn-main:b',
    fromSeq: 0,
    toSeq: 1,
    km: 1300,
    isHSR: true,
    geometry: { type: 'LineString', coordinates: [[116, 39], [121, 31]] },
  }],
  stations: [],
};

// fetchOne() now reads res.arrayBuffer() (to SHA-256 the bytes before parse), so a stubbed package
// Response must expose BOTH json() and arrayBuffer(). R() builds one from a plain object.
const R = (obj: unknown, init: { ok?: boolean; status?: number } = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  json: async () => obj,
  arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(obj)).buffer as ArrayBuffer,
});

const manifest = {
  packages: {
    JP: {
      version: '2025.3.0',
      path: 'rail/jp-2025.3.json',
      migrations: [
        { fromVersion: '2025.1.0', toVersion: '2025.2.0', path: STEP_A_PATH },
        { fromVersion: '2025.2.0', toVersion: '2025.3.0', path: STEP_B_PATH },
      ],
    },
    CN: { version: '2025.1.0', path: 'rail/cn-jinghu-2025.json', migrations: [] },
  },
};

const mapA = { fromVersion: '2025.1.0', toVersion: '2025.2.0', segmentIdMap: { [OLD_SEG]: MID_SEG } };
const mapB = { fromVersion: '2025.2.0', toVersion: '2025.3.0', segmentIdMap: { [MID_SEG]: NEW_SEG } };

function stubFetch(opts: { mapBOk: boolean }) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('manifest')) return { ok: true, json: async () => manifest };
    if (u.includes(STEP_A_PATH)) return { ok: true, json: async () => mapA };
    if (u.includes(STEP_B_PATH)) {
      if (opts.mapBOk) return { ok: true, json: async () => mapB };
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (u.includes('cn-')) return R(cnPkg);
    return R(jpPkg2025_3);
  });
}

describe('N->N+2 geometry migration chain', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('FULL CHAIN: migrates 2025.1.0 events through both maps to 2025.3.0', async () => {
    vi.stubGlobal('fetch', stubFetch({ mapBOk: true }));
    const store = await import('./store');
    await store.clearAllRides();
    await store.addEvents([
      { id: 'e1', segmentId: OLD_SEG, railGeoVersion: '2025.1.0', source: 'manual', tripId: 't1', createdAt: 't' },
    ]);

    await store.init();
    await vi.waitFor(() => {
      expect(get(store.events).find((e) => e.id === 'e1')?.segmentId).toBe(NEW_SEG);
    });

    const e = get(store.events).find((x) => x.id === 'e1')!;
    expect(e.id).toBe('e1');
    expect(e.segmentId).toBe(NEW_SEG);
    expect(e.railGeoVersion).toBe('2025.3.0');
    expect(e.originalSegmentId).toBe(OLD_SEG);
    expect(get(store.dataDegraded)).toBe(false);
  });

  it('PARTIAL CHAIN: a later missing map leaves the event intact for a retry', async () => {
    const fetch = stubFetch({ mapBOk: false });
    vi.stubGlobal('fetch', fetch);
    const store = await import('./store');
    await store.clearAllRides();
    await store.addEvents([
      { id: 'e1', segmentId: OLD_SEG, railGeoVersion: '2025.1.0', source: 'manual', tripId: 't1', createdAt: 't' },
    ]);

    await store.init();
    await vi.waitFor(() => {
      expect(fetch.mock.calls.some(([url]) => String(url).includes(STEP_B_PATH))).toBe(true);
    });
    await new Promise((r) => setTimeout(r, 0));

    // Current engine behavior is all-or-nothing for the computed chain: map A can map OLD->MID
    // locally, but if map B is unavailable, no intermediate segment/version is persisted.
    const all = get(store.events);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: 'e1',
      segmentId: OLD_SEG,
      railGeoVersion: '2025.1.0',
    });
    expect(all[0].originalSegmentId).toBeUndefined();
  });

  it('IDEMPOTENT: an already-current reboot does not fetch maps or rewrite originalSegmentId', async () => {
    const fetch = stubFetch({ mapBOk: true });
    vi.stubGlobal('fetch', fetch);
    const store = await import('./store');
    await store.clearAllRides();
    await store.addEvents([
      {
        id: 'e1',
        segmentId: NEW_SEG,
        originalSegmentId: OLD_SEG,
        railGeoVersion: '2025.3.0',
        source: 'manual',
        tripId: 't1',
        createdAt: 't',
      },
    ]);

    await store.init();
    await new Promise((r) => setTimeout(r, 0));

    const e = get(store.events).find((x) => x.id === 'e1')!;
    expect(e.segmentId).toBe(NEW_SEG);
    expect(e.railGeoVersion).toBe('2025.3.0');
    expect(e.originalSegmentId).toBe(OLD_SEG);
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/migrations/'))).toBe(false);
  });
});
