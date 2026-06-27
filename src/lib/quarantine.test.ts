// Phase 4 quarantine tests mirror the boot tests' fresh-module harness so persistence
// survives a simulated reboot.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import type { RailGeoPackage, RideEvent } from '../contract/types';

const ACTIVE_SEG = 'jp-東日本旅客鉄道-中央線:001-002';
const ORPHAN_SEG = 'jp-東日本旅客鉄道-山手線:004095-004135';
const ORPHAN_SEG_2 = 'jp-東日本旅客鉄道-山手線:004135-004200';
const OTHER_ORPHAN_SEG = 'jp-東日本旅客鉄道-青梅線:100-101';

const jpPkg: RailGeoPackage = {
  version: '2026.1.0',
  generatedAt: 't',
  crs: 'WGS84',
  country: 'JP',
  lines: [{
    lineId: 'jp-東日本旅客鉄道-中央線',
    name: '中央線',
    country: 'JP',
    isHSR: false,
    isLoop: false,
    stationOrder: ['jp-chuo:a', 'jp-chuo:b'],
    geometry: { type: 'LineString', coordinates: [[139, 35], [139.1, 35]] },
  }],
  segments: [{
    segmentId: ACTIVE_SEG,
    lineId: 'jp-東日本旅客鉄道-中央線',
    fromStationId: 'jp-chuo:a',
    toStationId: 'jp-chuo:b',
    fromSeq: 0,
    toSeq: 1,
    km: 7.25,
    isHSR: false,
    geometry: { type: 'LineString', coordinates: [[139, 35], [139.1, 35]] },
  }],
  stations: [],
};

const R = (obj: unknown, init: { ok?: boolean; status?: number } = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  json: async () => obj,
  arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(obj)).buffer as ArrayBuffer,
});

function ev(over: Partial<RideEvent> = {}): RideEvent {
  return {
    id: 'e1',
    segmentId: ORPHAN_SEG,
    railGeoVersion: jpPkg.version,
    source: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('Phase 4 orphan quarantine', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('surfaces pending orphans by parsed line label, grouped by size and newest ride first', async () => {
    const store = await import('./store');
    store.loadPackages([jpPkg]);
    await store.clearAllRides();

    await store.addEvents([
      ev({ id: 'old-yamanote', segmentId: ORPHAN_SEG, date: '2025-01-01', km: 1.1 }),
      ev({ id: 'new-yamanote', segmentId: ORPHAN_SEG_2, date: '2025-02-01', km: 1.2 }),
      ev({ id: 'ome', segmentId: OTHER_ORPHAN_SEG, date: '2025-03-01', km: 2.5 }),
    ]);

    expect(get(store.orphanCount)).toBe(3);
    expect(get(store.dataDegraded)).toBe(false);
    expect(get(store.orphanGroups)).toEqual([
      {
        lineId: 'jp-東日本旅客鉄道-山手線',
        lineLabel: '山手線',
        rides: [
          { id: 'new-yamanote', segmentId: ORPHAN_SEG_2, lineLabel: '山手線', date: '2025-02-01', km: 1.2 },
          { id: 'old-yamanote', segmentId: ORPHAN_SEG, lineLabel: '山手線', date: '2025-01-01', km: 1.1 },
        ],
      },
      {
        lineId: 'jp-東日本旅客鉄道-青梅線',
        lineLabel: '青梅線',
        rides: [
          { id: 'ome', segmentId: OTHER_ORPHAN_SEG, lineLabel: '青梅線', date: '2025-03-01', km: 2.5 },
        ],
      },
    ]);
  });

  it('keeps an orphan as a closed line, persists it, and does not show it after reboot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => R(jpPkg)));
    let store = await import('./store');
    store.loadPackages([jpPkg]);
    await store.clearAllRides();
    await store.addEvents([ev({ id: 'closed', km: 12.34, date: '2025-04-01' })]);

    expect(get(store.orphanCount)).toBe(1);
    await store.keepAsOrphan(['closed']);

    expect(get(store.orphanGroups)).toEqual([]);
    expect(get(store.dataDegraded)).toBe(false);
    expect(get(store.closedLineCount)).toBe(1);
    expect(get(store.closedLineKm)).toBe(12.34);

    vi.resetModules();
    store = await import('./store');
    await store.init();

    expect(get(store.orphanGroups)).toEqual([]);
    expect(get(store.closedLineCount)).toBe(1);
    expect(get(store.closedLineKm)).toBe(12.34);
  });

  it('does not mass-quarantine events while their namespace package is degraded', async () => {
    const store = await import('./store');
    store.loadPackages([jpPkg]);
    store.usingFallback.set(true);
    await store.clearAllRides();

    await store.addEvents([ev({ id: 'fallback-hidden', segmentId: ORPHAN_SEG })]);

    expect(get(store.orphanGroups)).toEqual([]);
    expect(get(store.orphanCount)).toBe(0);
  });

  it('snapshots km for freshly added resolving events without overwriting an existing km', async () => {
    const store = await import('./store');
    store.loadPackages([jpPkg]);
    await store.clearAllRides();

    await store.addEvents([
      ev({ id: 'snap', segmentId: ACTIVE_SEG }),
      ev({ id: 'preserve', segmentId: ACTIVE_SEG, km: 99 }),
    ]);

    expect(get(store.events).find((e) => e.id === 'snap')?.km).toBe(7.25);
    expect(get(store.events).find((e) => e.id === 'preserve')?.km).toBe(99);
  });
});
