// Boot-path tests for init()'s package fetch + fallback (codex #8 regression). init() is
// idempotent via a module-level flag, so each case gets a FRESH store module via
// vi.resetModules() + dynamic import, with global fetch stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import type { RailGeoPackage } from '../contract/types';
import { STUB_VERSION } from './fallback-package';

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

// fetchOne() now reads res.arrayBuffer() (to SHA-256 the bytes before parse), so a stubbed package
// Response must expose BOTH json() and arrayBuffer(). R() builds one from a plain object.
const R = (obj: unknown, init: { ok?: boolean; status?: number } = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  json: async () => obj,
  arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(obj)).buffer as ArrayBuffer,
});

describe('init() package fetch + fallback', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('loads the real package when the fetch succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => R(realPkg)));
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
    vi.stubGlobal('fetch', vi.fn(async () => R({ lines: [], segments: [] })));
    const store = await import('./store');
    await store.init();
    expect(get(store.usingFallback)).toBe(true);
  });

  it('falls back on a non-OK HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => R({}, { ok: false, status: 404 })));
    const store = await import('./store');
    await store.init();
    expect(get(store.usingFallback)).toBe(true);
  });

  it('retries the real package on `online` and self-heals (codex#8 recovery path)', async () => {
    // fetchPackages now makes several fetches per boot (manifest + jp + cn), so model failure per
    // BOOT not per call: the manifest fetch starts each boot — fail everything on boot 1, heal on boot 2.
    let boot = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('manifest')) boot += 1;
      if (boot <= 1) throw new Error('first boot offline'); // entire first boot fails → fallback
      return R(realPkg);
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
    vi.stubGlobal('fetch', vi.fn(async (url: string) => R(url.includes('cn') ? cnPkg : realPkg)));
    const store = await import('./store');
    await store.init();
    expect(get(store.packages).map((p) => p.country).sort()).toEqual(['CN', 'JP']);
  });

  it('REJECTS a wrong-country payload — a CN url serving a JP package never loads as CN', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => R(realPkg))); // JP for BOTH urls
    const store = await import('./store');
    await store.init();
    const pkgs = get(store.packages);
    expect(pkgs.every((p) => p.country === 'JP')).toBe(true); // the CN-url JP payload was rejected
    expect(pkgs).toHaveLength(1); // JP only — no second, mis-namespaced package
  });

  it('REJECTS a package whose bytes mismatch the manifest SHA-256 (poisoned/truncated artifact)', async () => {
    const badManifest = {
      schemaVersion: 2,
      packages: {
        JP: { version: '2025.1.0', path: 'rail/jp-2025.json', sha256: 'de'.repeat(32), migrations: [] },
        CN: { version: '2025.1.0', path: 'rail/cn-jinghu-2025.json', sha256: 'de'.repeat(32), migrations: [] },
      },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('manifest') ? { ok: true, json: async () => badManifest } : R(realPkg),
    )); // real package bytes — their true hash will NOT equal the manifest's bogus sha
    const store = await import('./store');
    await store.init();
    expect(get(store.usingFallback)).toBe(true); // sha mismatch → JP rejected → stub fallback, never a bad denominator
  });

  it('NO fake-CN fallback: a JP failure boots JP-only, never a stub CN package', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const store = await import('./store');
    await store.init();
    expect(get(store.usingFallback)).toBe(true);
    expect(get(store.packages).some((p) => p.country === 'CN')).toBe(false); // no fake CN ids to record against
  });

  it('a HUNG fetch times out and degrades — never hangs the loading screen forever', async () => {
    vi.useFakeTimers();
    // fetch that never resolves on its own; only an abort (the timeout) rejects it.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, opts?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    const store = await import('./store');
    const initP = store.init();
    // Manifest fetch aborts at MANIFEST_TIMEOUT_MS (5s) → path fallback → package fetch aborts at
    // +FETCH_TIMEOUT_MS (15s). Advance past both serial timeouts so boot degrades, never hangs.
    await vi.advanceTimersByTimeAsync(21_000);
    await initP;
    expect(get(store.ready)).toBe(true); // booted, not stuck on the splash
    expect(get(store.usingFallback)).toBe(true); // timed out → JP-only fallback
    vi.useRealTimers();
  });
});

describe('N→N+1 geometry migration (GOLDEN: coverage preserved across a version bump)', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const OLD_SEG = 'x:0-1';
  const NEW_SEG = 'x:00100g-00101g';
  // v2 of the same JP package: the SAME physical segment, new group-pair id, version advanced.
  const v2Pkg: RailGeoPackage = { ...realPkg, version: '2025.2.0', segments: [{ ...realPkg.segments[0], segmentId: NEW_SEG }] };
  // JP bumped to 2025.2.0; CN stays at 2025.1.0 — independent versions. This is the case that a
  // GLOBAL version set gets wrong (CN's 2025.1.0 would mask a stale JP event also pinned 2025.1.0).
  const manifest = {
    packages: {
      JP: {
        version: '2025.2.0', path: 'rail/jp-2025.json',
        migrations: [{ fromVersion: '2025.1.0', toVersion: '2025.2.0', path: 'rail/migrations/jp/2025.1.0-to-2025.2.0.json' }],
      },
      CN: { version: '2025.1.0', path: 'rail/cn-jinghu-2025.json', migrations: [] },
    },
  };
  const map = { fromVersion: '2025.1.0', toVersion: '2025.2.0', segmentIdMap: { [OLD_SEG]: NEW_SEG } };
  const stubFetch = (mapResp: { ok: boolean; status?: number }) =>
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('manifest')) return { ok: true, json: async () => manifest };
      if (u.includes('/migrations/')) return { ...mapResp, json: async () => map };
      if (u.includes('cn-')) return R(cnPkg); // CN v1 (2025.1.0) loads for real
      return R(v2Pkg); // JP v2 (2025.2.0)
    });

  it('re-points a stale JP event EVEN WHILE CN sits at the old version; CN untouched, coverage self-heals', async () => {
    vi.stubGlobal('fetch', stubFetch({ ok: true }));
    const store = await import('./store');
    await store.clearAllRides();
    await store.addEvents([
      { id: 'e1', segmentId: OLD_SEG, railGeoVersion: '2025.1.0', source: 'manual', tripId: 't1', createdAt: 't' }, // JP, stale
      { id: 'cn1', segmentId: 'cn-x:0-1', railGeoVersion: '2025.1.0', source: 'manual', tripId: 'tc', createdAt: 't' }, // CN, current
    ]);
    await store.init();
    await vi.waitFor(() => {
      expect(get(store.events).find((e) => e.id === 'e1')?.segmentId).toBe(NEW_SEG); // async migration landed
    });
    const e = get(store.events).find((x) => x.id === 'e1')!;
    const cn = get(store.events).find((x) => x.id === 'cn1')!;
    expect(e.segmentId).toBe(NEW_SEG);            // JP migrated despite CN ALSO being pinned to 2025.1.0 (per-namespace!)
    expect(e.originalSegmentId).toBe(OLD_SEG);    // first-ever id recorded (reversibility)
    expect(e.railGeoVersion).toBe('2025.2.0');    // version advanced
    expect(e.id).toBe('e1');                      // primary key UNCHANGED — coverage keys on segmentId
    expect(cn.segmentId).toBe('cn-x:0-1');        // CN event LEFT ALONE (the CN package really is at 2025.1.0)
    expect(cn.railGeoVersion).toBe('2025.1.0');
    expect(get(store.dataDegraded)).toBe(false);  // the JP ride RESOLVES — coverage was NOT silently lost
    await store.clearAllRides();
  });

  it('is idempotent — a second boot does not re-migrate (event already at target version)', async () => {
    vi.stubGlobal('fetch', stubFetch({ ok: true }));
    const store = await import('./store');
    await store.clearAllRides();
    await store.addEvents([{ id: 'e1', segmentId: NEW_SEG, originalSegmentId: OLD_SEG, railGeoVersion: '2025.2.0', source: 'manual', tripId: 't1', createdAt: 't' }]);
    await store.init();
    await new Promise((r) => setTimeout(r, 0));
    const e = get(store.events).find((x) => x.id === 'e1')!;
    expect(e.originalSegmentId).toBe(OLD_SEG); // untouched — already current, not re-migrated
    expect(e.segmentId).toBe(NEW_SEG);
    await store.clearAllRides();
  });

  it('REGRESSION (stub version collision): a ride marked ON THE STUB is adopted by segmentId when the real package arrives — never dragged through a real migration chain', async () => {
    // The stub used to claim '2025.1.0' — a REAL shipped JP version with a live 2025.1.0→2025.2.0
    // migration — so a stub-marked ride was run through that real map (or quarantined). The stub now
    // pins STUB_VERSION, which no chain claims; the ride resolves against the real package by its
    // deterministic segmentId instead. The migration map here is a TRAP: it remaps the stub-marked
    // id, and the old behavior would have followed it.
    const STUB_SEG = 'jr-yamanote:0-1'; // a real stub segment (marking happens against the stub)
    const realJp: RailGeoPackage = {
      ...realPkg,
      version: '2025.2.0',
      segments: [{ ...realPkg.segments[0], segmentId: STUB_SEG, km: 2.22 }], // same id, real km
    };
    const collisionManifest = {
      packages: {
        JP: {
          version: '2025.2.0', path: 'rail/jp-2025.json',
          migrations: [{ fromVersion: '2025.1.0', toVersion: '2025.2.0', path: 'rail/migrations/jp/2025.1.0-to-2025.2.0.json' }],
        },
      },
    };
    const trapMap = { fromVersion: '2025.1.0', toVersion: '2025.2.0', segmentIdMap: { [STUB_SEG]: 'jr-yamanote:00wrong' } };
    let healed = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (!healed) throw new Error('first boot offline'); // boot 1 fails everything → stub
      if (u.includes('manifest')) return { ok: true, json: async () => collisionManifest };
      if (u.includes('/migrations/')) return { ok: true, json: async () => trapMap };
      if (u.includes('cn-')) throw new Error('no CN'); // JP-only heal keeps this test focused
      return R(realJp);
    }));
    const store = await import('./store');
    await store.clearAllRides();
    await store.init();
    expect(get(store.usingFallback)).toBe(true);
    await store.markRoute({ segmentIds: [STUB_SEG], lines: ['jr-yamanote'], totalKm: 2, lineChanges: 0, railGeoVersion: get(store.packages)[0].version });
    const marked = get(store.events)[0];
    expect(marked.railGeoVersion).toBe(STUB_VERSION); // pinned to the SYNTHETIC version, never a real one
    expect(marked.km).toBeGreaterThan(0); // route-marked events carry the Phase-4 km snapshot too

    healed = true;
    window.dispatchEvent(new Event('online')); // real package arrives
    await vi.waitFor(() => expect(get(store.events)[0]?.railGeoVersion).toBe('2025.2.0')); // adopted
    const ev = get(store.events)[0];
    expect(ev.segmentId).toBe(STUB_SEG);           // resolved BY ID — the trap map was never applied
    expect(ev.originalSegmentId).toBeUndefined();  // never entered the migration chain
    expect(ev.km).toBe(2.22);                      // km snapshot refreshed from real geometry
    expect(get(store.orphanCount)).toBe(0);        // NOT quarantined as abolished
    expect(get(store.dataDegraded)).toBe(false);   // the ride resolves — coverage is truthful again
    expect(get(store.litSegmentIds)).toContain(STUB_SEG);
    await store.clearAllRides();
  });

  it('REGRESSION (stub rides never misclassified as abolished): a stub ride the real package lacks stays pinned — no quarantine, surfaced as degraded', async () => {
    const STUB_ONLY_SEG = 'jr-kururi:0-1'; // in the stub, NOT in the healed real package below
    const realJp: RailGeoPackage = { ...realPkg, version: '2025.2.0' }; // real ids only (x:0-1)
    const healManifest = {
      packages: {
        JP: {
          version: '2025.2.0', path: 'rail/jp-2025.json',
          migrations: [{ fromVersion: '2025.1.0', toVersion: '2025.2.0', path: 'rail/migrations/jp/2025.1.0-to-2025.2.0.json' }],
        },
      },
    };
    let healed = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (!healed) throw new Error('first boot offline');
      if (u.includes('manifest')) return { ok: true, json: async () => healManifest };
      if (u.includes('/migrations/')) return { ok: true, json: async () => ({ segmentIdMap: {} }) }; // maps nothing
      if (u.includes('cn-')) throw new Error('no CN');
      return R(realJp);
    }));
    const store = await import('./store');
    await store.clearAllRides();
    await store.init();
    await store.markRoute({ segmentIds: [STUB_ONLY_SEG], lines: ['jr-kururi'], totalKm: 2, lineChanges: 0, railGeoVersion: get(store.packages)[0].version });

    healed = true;
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(get(store.usingFallback)).toBe(false)); // real package swapped in
    await new Promise((r) => setTimeout(r, 25)); // let the async adoption/migration pass fully settle
    const ev = get(store.events)[0];
    expect(ev.segmentId).toBe(STUB_ONLY_SEG);       // untouched
    expect(ev.railGeoVersion).toBe(STUB_VERSION);   // still stub-pinned — never fed a real version
    expect(get(store.orphanCount)).toBe(0);         // the OLD behavior quarantined this as "abolished"
    expect(get(store.dataDegraded)).toBe(true);     // unresolved ≠ silent 0% — surfaced honestly
    await store.clearAllRides();
  });

  it('OFFLINE/404 migration map: events left intact (no silent loss), not mutated', async () => {
    vi.stubGlobal('fetch', stubFetch({ ok: false, status: 404 }));
    const store = await import('./store');
    await store.clearAllRides();
    await store.addEvents([{ id: 'e1', segmentId: OLD_SEG, railGeoVersion: '2025.1.0', source: 'manual', tripId: 't1', createdAt: 't' }]);
    await store.init();
    await new Promise((r) => setTimeout(r, 0));
    const e = get(store.events).find((x) => x.id === 'e1')!;
    expect(e.segmentId).toBe(OLD_SEG);          // NOT mutated — the map could not load
    expect(e.railGeoVersion).toBe('2025.1.0');  // still old (degraded, will retry online — never silently dropped)
    await store.clearAllRides();
  });
});
