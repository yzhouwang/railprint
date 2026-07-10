import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  loadPackages,
  clearAllRides,
  markRide,
  markRoute,
  removeTrip,
  addEvents,
  removeImportBatch,
  replaceEvents,
  setTripTrainModel,
  restoreEvents,
  collectedModelKeys,
  seedCelebratedMilestones,
  celebrateNewMilestones,
  hasCelebratedSeed,
  events,
  headline,
  litSegmentIds,
} from './store';
import { resolveCoverage } from './resolver';
import { JP_PACKAGE, STUB_PACKAGES, stationByName } from './fallback-package';
import type { RideEvent, RouteCandidate } from '../contract/types';

const route = (segmentIds: string[]): RouteCandidate => ({
  segmentIds,
  lines: [...new Set(segmentIds.map((s) => s.split(':')[0]))],
  totalKm: 10,
  lineChanges: 0,
  railGeoVersion: JP_PACKAGE.version,
});

const sid = (lineId: string, name: string): string => stationByName(JP_PACKAGE, lineId, name).stationId;

beforeEach(async () => {
  loadPackages(STUB_PACKAGES);
  await clearAllRides();
});

describe('markRide', () => {
  it('lights the slice and ticks the headline up', async () => {
    const before = get(headline).riddenKm;
    const res = await markRide({
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
      date: '2025-03-01',
    });
    expect(res.added).toBe(4);
    expect(res.alreadyCovered).toBe(0);
    expect(get(litSegmentIds)).toEqual(
      ['jr-kururi:0-1', 'jr-kururi:1-2', 'jr-kururi:2-3', 'jr-kururi:3-4'].sort(),
    );
    expect(get(headline).riddenKm).toBeGreaterThan(before);
  });

  it('assigns one shared tripId to every leg of a marking', async () => {
    await markRide({
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
    });
    const tripIds = new Set(get(events).map((e) => e.tripId));
    expect(tripIds.size).toBe(1);
    expect([...tripIds][0]).toBeTruthy();
  });

  it('re-riding the same slice appends a second trip while coverage stays stable', async () => {
    const opts = {
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
    };
    const first = await markRide(opts);
    const firstRows = get(events);
    const firstCoverage = resolveCoverage(firstRows, JP_PACKAGE);
    const second = await markRide(opts);
    const all = get(events);
    const secondCoverage = resolveCoverage(all, JP_PACKAGE);

    expect(first.added).toBe(4);
    expect(second.added).toBe(4);
    expect(second.alreadyCovered).toBe(4);
    expect(all).toHaveLength(8);
    expect(secondCoverage.litSegmentIds).toHaveLength(firstCoverage.litSegmentIds.length);
    expect(secondCoverage.riddenKm).toBe(firstCoverage.riddenKm);
    expect(new Set(all.map((e) => e.tripId)).size).toBe(2);
    expect(all.find((e) => e.id === firstRows[0].id)).toEqual(firstRows[0]);
  });

  it('a concurrent double-mark records two trips but still lights each segment once', async () => {
    const args = {
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
    };
    const [a, b] = await Promise.all([markRide(args), markRide(args)]);
    expect(a.added + b.added).toBe(8);
    expect(get(events)).toHaveLength(8);
    expect(get(litSegmentIds)).toHaveLength(4);
    expect(new Set(get(events).map((e) => e.tripId)).size).toBe(2);
  });

  it('persists the full slice on a partial-overlap re-mark', async () => {
    await markRide({
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
    });
    expect(get(events).length).toBe(4);
    const second = await markRide({
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '馬来田'), // overlaps the first 4 segs + 2 new
      pkg: JP_PACKAGE,
    });
    expect(second.added).toBe(6);
    expect(second.alreadyCovered).toBe(4);
    expect(get(events).length).toBe(10); // first 4 + full second slice of 6
    expect(get(litSegmentIds)).toHaveLength(6);
  });

  it('a same-trip double-submit overwrites deterministic event ids instead of duplicating', async () => {
    const uuid = '00000000-0000-4000-8000-000000000000' as ReturnType<typeof crypto.randomUUID>;
    const spy = vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
    try {
      const opts = {
        lineId: 'jr-kururi',
        fromStationId: sid('jr-kururi', '木更津'),
        toStationId: sid('jr-kururi', '横田'),
        pkg: JP_PACKAGE,
      };
      await markRide(opts);
      const second = await markRide(opts);
      expect(second.alreadyCovered).toBe(4);
      expect(get(events)).toHaveLength(4);
      expect(new Set(get(events).map((e) => e.tripId))).toEqual(new Set([uuid]));
    } finally {
      spy.mockRestore();
    }
  });

  it('canonicalizes trainModel on the stored event', async () => {
    await markRide({
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
      trainModel: 'n700-s',
    });
    expect(get(events)[0].trainModel).toBe('N700S');
  });

  it('throws when the two stations are not on the same line', async () => {
    await expect(
      markRide({
        lineId: 'jr-kururi',
        fromStationId: sid('jr-kururi', '木更津'),
        toStationId: sid('jr-yamanote', '東京'),
        pkg: JP_PACKAGE,
      }),
    ).rejects.toThrow();
  });
});

describe('event log operations', () => {
  function imported(segmentId: string, batch: string): RideEvent {
    return {
      id: `${batch}:${segmentId}`,
      segmentId,
      railGeoVersion: JP_PACKAGE.version,
      source: 'import',
      importBatchId: batch,
      createdAt: '2025-01-01T00:00:00.000Z',
    };
  }

  it('merges added events and can undo a whole import batch', async () => {
    const seg = JP_PACKAGE.segments[0].segmentId;
    await addEvents([imported(seg, 'batch-1')]);
    expect(get(litSegmentIds)).toContain(seg);
    await removeImportBatch('batch-1');
    expect(get(litSegmentIds)).not.toContain(seg);
  });

  it('replaceEvents wipes prior state (merge-vs-replace = replace)', async () => {
    await addEvents([imported(JP_PACKAGE.segments[0].segmentId, 'b1')]);
    await replaceEvents([imported(JP_PACKAGE.segments[5].segmentId, 'b2')]);
    expect(get(litSegmentIds)).toEqual([JP_PACKAGE.segments[5].segmentId]);
  });

  it('can remove a just-made trip', async () => {
    const res = await markRide({
      lineId: 'jr-kururi',
      fromStationId: sid('jr-kururi', '木更津'),
      toStationId: sid('jr-kururi', '横田'),
      pkg: JP_PACKAGE,
    });
    expect(get(events)).toHaveLength(4);
    await removeTrip(res.tripId);
    expect(get(events)).toHaveLength(0);
  });
});

describe('markRoute (cross-line, one trip)', () => {
  const SEGS = ['jr-kururi:0-1', 'jr-kururi:1-2', 'jr-kururi:2-3'];

  it('marks every leg of a route under one tripId', async () => {
    const res = await markRoute(route(SEGS), { date: '2025-06-01' });
    expect(res.added).toBe(3);
    expect(res.alreadyCovered).toBe(0);
    const evs = get(events).filter((e) => SEGS.includes(e.segmentId));
    expect(evs).toHaveLength(3);
    expect(new Set(evs.map((e) => e.tripId)).size).toBe(1);
    expect(evs[0].tripId).toBe(res.tripId);
  });

  it('appends overlapping legs into a new trip without mutating the old trip', async () => {
    await markRoute(route(['jr-kururi:0-1']), { date: '2025-01-01' });
    const before = get(events).length;
    const firstLeg = get(events).find((e) => e.segmentId === 'jr-kururi:0-1')!;

    const res = await markRoute(route(['jr-kururi:0-1', 'jr-kururi:1-2']), { date: '2025-06-01' });
    expect(res.added).toBe(2);
    expect(res.alreadyCovered).toBe(1);
    expect(get(events).length).toBe(before + 2);

    expect(get(events).find((e) => e.id === firstLeg.id)).toEqual(firstLeg);
    const newLeg = get(events).find((e) => e.id === `${res.tripId}:jr-kururi:0-1`)!;
    expect(newLeg.tripId).toBe(res.tripId);
    expect(newLeg.date).toBe('2025-06-01');
  });

  it('creates a second trip after a full re-mark of the same route', async () => {
    const segs = ['jr-kururi:0-1', 'jr-kururi:1-2'];
    const first = await markRoute(route(segs));
    const second = await markRoute(route(segs));
    const ids = get(events).map((e) => e.segmentId).filter((s) => segs.includes(s));
    expect(ids.length).toBe(4);
    expect(new Set(get(events).map((e) => e.tripId))).toEqual(new Set([first.tripId, second.tripId]));
    expect(second.alreadyCovered).toBe(2);
  });

  it('returns alreadyCovered:N when every leg was already ridden', async () => {
    const segs = ['jr-kururi:0-1', 'jr-kururi:1-2'];
    await markRoute(route(segs));
    const res = await markRoute(route(segs)); // re-mark the whole route
    expect(res.added).toBe(2);
    expect(res.alreadyCovered).toBe(2);
  });

  it('canonicalizes trainModel on route events', async () => {
    await markRoute(route(['jr-kururi:0-1']), { trainModel: 'N700 S系' });
    expect(get(events)[0].trainModel).toBe('N700S');
  });
});

// ─────────────────── setTripTrainModel (v0.13 D7 — edit-in-place) ───────────────────

describe('setTripTrainModel', () => {
  /** A trip whose rows carry every at-risk field: km snapshot, quarantine, importBatchId. */
  const richTrip = (): RideEvent[] => [
    {
      id: 'trip-a:jr-kururi:0-1',
      segmentId: 'jr-kururi:0-1',
      railGeoVersion: JP_PACKAGE.version,
      km: 5.5, // the v0.12.2.0 bug-class field — must survive an edit byte-identically
      date: '2025-03-01',
      trainModel: 'E5',
      source: 'import',
      tripId: 'trip-a',
      importBatchId: 'batch-1',
      createdAt: '2025-03-01T00:00:00.000Z',
    },
    {
      id: 'trip-a:jr-kururi:1-2',
      segmentId: 'jr-kururi:1-2',
      railGeoVersion: JP_PACKAGE.version,
      km: 3.25,
      date: '2025-03-01',
      trainModel: 'キハ261',
      source: 'import',
      tripId: 'trip-a',
      importBatchId: 'batch-1',
      quarantine: 'kept', // a kept 廃線 row must never re-quarantine
      createdAt: '2025-03-01T00:00:00.000Z',
    },
    {
      id: 'trip-a:jr-kururi:2-3',
      segmentId: 'jr-kururi:2-3',
      railGeoVersion: JP_PACKAGE.version,
      km: 2.75,
      date: '2025-03-01',
      // no trainModel — the ＋車両 target row
      source: 'import',
      tripId: 'trip-a',
      importBatchId: 'batch-1',
      createdAt: '2025-03-01T00:00:00.000Z',
    },
  ];

  it('CRITICAL: every row is byte-identical EXCEPT trainModel (7A all-fields invariance)', async () => {
    await addEvents(richTrip());
    const before = get(events);
    const coverageBefore = resolveCoverage(before, JP_PACKAGE);
    const litBefore = get(litSegmentIds);

    const target = before.filter((e) => e.trainModel === 'E5').map((e) => e.id);
    const res = await setTripTrainModel(target, 'H5系');
    expect(res.updated).toBe(1);

    const after = get(events);
    for (const prior of before) {
      const now = after.find((e) => e.id === prior.id)!;
      if (target.includes(prior.id)) {
        // ONLY trainModel differs — km snapshot, quarantine, batch id, version, source,
        // date, createdAt, tripId, id all pinned.
        expect(now).toEqual({ ...prior, trainModel: 'H5' });
      } else {
        expect(now).toEqual(prior);
      }
    }
    const coverageAfter = resolveCoverage(after, JP_PACKAGE);
    expect(coverageAfter.riddenKm).toBe(coverageBefore.riddenKm);
    expect(coverageAfter.pctNational).toBe(coverageBefore.pctNational);
    expect(get(litSegmentIds)).toEqual(litBefore);
  });

  it('is per-pill scoped (13A): editing the E5 pill never touches the キハ261 row', async () => {
    await addEvents(richTrip());
    const rows = get(events);
    const e5Ids = rows.filter((e) => e.trainModel === 'E5').map((e) => e.id);
    await setTripTrainModel(e5Ids, 'N700S');
    const after = get(events);
    expect(after.find((e) => e.id === 'trip-a:jr-kururi:1-2')!.trainModel).toBe('キハ261');
    expect(after.find((e) => e.id === 'trip-a:jr-kururi:2-3')!.trainModel).toBeUndefined();
  });

  it('＋車両 fills only the blank rows the caller scoped', async () => {
    await addEvents(richTrip());
    const blanks = get(events).filter((e) => !e.trainModel).map((e) => e.id);
    const res = await setTripTrainModel(blanks, 'e7系');
    expect(res.updated).toBe(1);
    const after = get(events);
    expect(after.find((e) => e.id === 'trip-a:jr-kururi:2-3')!.trainModel).toBe('E7'); // canonicalized at write
    expect(after.find((e) => e.id === 'trip-a:jr-kururi:0-1')!.trainModel).toBe('E5');
  });

  it('handles solo (trip-less) events by id, clears on empty input, no-ops on same value', async () => {
    await addEvents([
      {
        id: 'solo-1',
        segmentId: 'jr-kururi:0-1',
        railGeoVersion: JP_PACKAGE.version,
        trainModel: 'E6',
        source: 'manual',
        createdAt: '2025-04-01T00:00:00.000Z',
      },
    ]);
    // same value → no write
    const noop = await setTripTrainModel(['solo-1'], 'E6系');
    expect(noop.updated).toBe(0);
    // clear via empty string → undefined
    const cleared = await setTripTrainModel(['solo-1'], '  ');
    expect(cleared.updated).toBe(1);
    expect(get(events).find((e) => e.id === 'solo-1')!.trainModel).toBeUndefined();
    // unknown ids → safe no-op
    const ghost = await setTripTrainModel(['does-not-exist'], 'E5');
    expect(ghost.updated).toBe(0);
    expect(ghost.prior).toHaveLength(0);
  });

  it('undo restores the exact prior rows (restoreEvents round-trip)', async () => {
    await addEvents(richTrip());
    const before = get(events);
    const target = before.filter((e) => e.trainModel === 'E5').map((e) => e.id);
    const { prior } = await setTripTrainModel(target, 'W7');
    expect(get(events).find((e) => e.id === target[0])!.trainModel).toBe('W7');
    await restoreEvents(prior);
    // byte-identical restoration, including untouched siblings
    expect(get(events).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      before.sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it('two sequential edits: undo of the FIRST restores its snapshot — the UI must invalidate it (8A)', async () => {
    await addEvents(richTrip());
    const target = get(events).filter((e) => e.trainModel === 'E5').map((e) => e.id);
    const first = await setTripTrainModel(target, 'H5');
    const second = await setTripTrainModel(target, 'E8');
    expect(get(events).find((e) => e.id === target[0])!.trainModel).toBe('E8');
    // Restoring the FIRST snapshot silently discards the E8 edit — this documented hazard is
    // exactly why the diary dismisses a trip's earlier undo toast on every new edit (8A).
    await restoreEvents(first.prior);
    expect(get(events).find((e) => e.id === target[0])!.trainModel).toBe('E5');
    void second;
  });
});

// ─────────── collectedModelKeys (D14 membership — registry-resolved folds) ───────────

describe('collectedModelKeys', () => {
  it('keys alias spellings by their REGISTRY fold, matching summarizeCollection (review fix)', async () => {
    await addEvents([
      {
        id: 'a1',
        segmentId: 'jr-kururi:0-1',
        railGeoVersion: JP_PACKAGE.version,
        trainModel: 'N700系7000番台', // registry alias — its own foldKey ≠ the card fold
        source: 'manual',
        createdAt: '2025-05-01T00:00:00.000Z',
      },
      {
        id: 'a2',
        segmentId: 'jr-kururi:1-2',
        railGeoVersion: JP_PACKAGE.version,
        trainModel: 'おもちゃ', // unknown free text — keys by its own fold, never dropped
        source: 'manual',
        createdAt: '2025-05-01T00:00:00.000Z',
      },
    ]);
    const keys = get(collectedModelKeys);
    expect(keys.has('N700')).toBe(true); // the CARD fold — so marking 'N700系' is NOT "new"
    expect(keys.has('N700系7000番台')).toBe(false); // raw alias fold never leaks as an identity
    expect(keys.has('おもちゃ')).toBe(true);
  });
});

// ──────── celebration meta (D11/6A — once per device EVER; seeds are silent) ────────

describe('celebration meta (seed / celebrate / dedupe)', () => {
  /** Ride an E5 so the collection earns 初車両 + 320km/hクラブ. */
  const rideE5 = () =>
    addEvents([
      {
        id: 'cel-1',
        segmentId: 'jr-kururi:0-1',
        railGeoVersion: JP_PACKAGE.version,
        trainModel: 'E5系',
        source: 'manual',
        tripId: 'cel-t1',
        createdAt: '2025-06-01T00:00:00.000Z',
      },
    ]);

  it('hasCelebratedSeed is false on a fresh device and true after any seed', async () => {
    expect(await hasCelebratedSeed()).toBe(false);
    await seedCelebratedMilestones();
    expect(await hasCelebratedSeed()).toBe(true);
  });

  it('celebrates a fresh crossing ONCE — the second call returns [] (once per device, ever)', async () => {
    await rideE5();
    const first = await celebrateNewMilestones();
    expect(first.map((m) => m.id).sort()).toEqual(['club-320', 'first-model']);
    const second = await celebrateNewMilestones();
    expect(second).toEqual([]); // the dedupe: no repeat toast for the same stamps
  });

  it('a SEED suppresses the burst: restore-then-celebrate yields [] (6A — no stale-stamp burst)', async () => {
    await rideE5(); // "restored history" — earned before this device ever celebrated
    await seedCelebratedMilestones(); // import/boot-upgrade path seeds silently
    expect(await celebrateNewMilestones()).toEqual([]);
  });

  it('concurrent celebrate calls are serialized — the same crossing never double-toasts', async () => {
    await rideE5();
    const [a, b] = await Promise.all([celebrateNewMilestones(), celebrateNewMilestones()]);
    // exactly ONE of the racing calls wins the fresh stamps; the other sees them celebrated
    expect(a.length + b.length).toBe(2);
    expect(a.length === 0 || b.length === 0).toBe(true);
  });
});
