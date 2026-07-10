import { describe, it, expect } from 'vitest';
import {
  summarizeCollection,
  deriveMilestones,
  earnedMilestoneIds,
  type CollectionSummary,
  type ModelStanding,
} from './collection';
import { MODEL_REGISTRY } from './model-registry';
import type { RailGeoPackage, RailSegment, RideEvent } from '../contract/types';

// ── tiny inline fixture packages (trips.test.ts style, but shape-minimal: the collection
// core reads ONLY pkg.segments' segmentId/lineId/km — lines/stations stay empty) ──

function pkg(
  country: 'JP' | 'CN',
  segs: [segmentId: string, lineId: string, km: number][],
): RailGeoPackage {
  const segments: RailSegment[] = segs.map(([segmentId, lineId, km], i) => ({
    segmentId,
    lineId,
    fromStationId: `${lineId}:a${i}`,
    toStationId: `${lineId}:b${i}`,
    fromSeq: i,
    toSeq: i + 1,
    km,
    isHSR: false,
    geometry: { type: 'LineString', coordinates: [[0, i], [1, i]] },
  }));
  return {
    version: 'test-1.0.0',
    generatedAt: '2026-01-01T00:00:00.000Z',
    crs: 'WGS84',
    country,
    lines: [],
    segments,
    stations: [],
  };
}

const JP = pkg('JP', [
  ['jp-a:0-1', 'jp-a', 10.5],
  ['jp-a:1-2', 'jp-a', 4.25],
  ['jp-b:0-1', 'jp-b', 7],
  ['jp-a:2-3', 'jp-a', 1.111],
  ['jp-a:3-4', 'jp-a', 2.222],
]);
const CN = pkg('CN', [
  ['cn-jh:0-1', 'cn-jh', 100],
  ['cn-jh:1-2', 'cn-jh', 250.75],
]);

let counter = 0;
function ev(segmentId: string, over: Partial<RideEvent> = {}): RideEvent {
  return {
    id: `e${counter++}`,
    segmentId,
    railGeoVersion: 'test-1.0.0',
    source: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const standingOf = (s: CollectionSummary, fold: string): ModelStanding | undefined =>
  s.sections.flatMap((sec) => sec.collected).find((m) => m.fold === fold);
const sectionOf = (s: CollectionSummary, category: string) =>
  s.sections.find((sec) => sec.category === category);

describe('summarizeCollection — fold identity (D2/D8)', () => {
  it('folds imported E5系 + manual e5 onto ONE standing: registry displayName, both spellings kept', () => {
    // WHY: imports store raw trimmed strings while manual marks canonicalize (plan hole #3) —
    // the read-time fold is the only thing keeping them one card. Spellings survive for the
    // model-detail honesty view ("E5系 として記録: N回"); stored strings are never rewritten (D4).
    const s = summarizeCollection(
      [
        ev('jp-a:0-1', { tripId: 'a', trainModel: 'E5系' }),
        ev('jp-a:1-2', { tripId: 'b', trainModel: 'e5' }),
      ],
      [JP],
    );
    expect(s.totalModels).toBe(1);
    const e5 = standingOf(s, 'E5')!;
    expect(e5.displayName).toBe('E5系');
    expect(e5.info?.id).toBe('jp-jre-e5');
    expect(e5.spellings).toEqual(['E5系', 'e5']); // first-seen order, raw
    expect(e5.rideCount).toBe(2);
  });

  it('merges a registry ALIAS spelling onto the entry card (fold is a lookup, never the identity)', () => {
    // WHY (D2): 'N700系7000番台' folds to its own token, but the alias index maps it to the
    // N700 card — two standings for one registry entry would render the card twice in the grid.
    const s = summarizeCollection(
      [
        ev('jp-a:0-1', { tripId: 'a', trainModel: 'N700系7000番台' }),
        ev('jp-a:1-2', { tripId: 'b', trainModel: 'N700' }),
      ],
      [JP],
    );
    expect(s.totalModels).toBe(1);
    const n700 = standingOf(s, 'N700')!;
    expect(n700.displayName).toBe('N700系');
    expect(n700.spellings).toEqual(['N700系7000番台', 'N700']);
    expect(n700.rideCount).toBe(2);
  });

  it('keeps unknown キハE130X verbatim as a first-class その他 card — never dropped', () => {
    // WHY (D6): unknown free-text models are the honesty valve for the ~hundreds of 形式 the
    // curated registry doesn't carry; dropping them would make logged rides lie.
    const s = summarizeCollection([ev('jp-a:0-1', { trainModel: 'キハE130X' })], [JP]);
    expect(s.totalModels).toBe(1);
    const other = sectionOf(s, 'other')!;
    expect(other.label).toBe('その他');
    expect(other.collected).toHaveLength(1);
    expect(other.collected[0].displayName).toBe('キハE130X');
    expect(other.collected[0].info).toBeUndefined();
    expect(s.byCountry.other).toBe(1);
  });

  it('orders その他 by lastRidden desc (fresh discoveries first)', () => {
    const s = summarizeCollection(
      [
        ev('jp-a:0-1', { trainModel: '謎A', date: '2026-01-05' }),
        ev('jp-a:1-2', { trainModel: '謎B', date: '2026-06-05' }),
      ],
      [JP],
    );
    expect(sectionOf(s, 'other')!.collected.map((m) => m.displayName)).toEqual(['謎B', '謎A']);
  });

  it('splits byCountry via registry country; unknown folds count as other', () => {
    const s = summarizeCollection(
      [
        ev('jp-a:0-1', { trainModel: 'E5' }),
        ev('cn-jh:0-1', { trainModel: 'CR400AF' }),
        ev('jp-b:0-1', { trainModel: 'マイトレイン' }),
      ],
      [JP, CN],
    );
    expect(s.byCountry).toEqual({ JP: 1, CN: 1, other: 1 });
    expect(s.totalModels).toBe(3);
  });
});

describe('rideCount counts TRIPS, never events (12A)', () => {
  it('a 10-leg trip with E5 on every leg counts ONCE; a second trip makes 2', () => {
    // WHY: RideEvent is per-segment — one 東京→新青森 journey is ONE ride of the E5, not ten.
    // Bucketing is tripId ?? solo:<id>, exactly like trips.ts, and needs NO segment resolution.
    const legs = Array.from({ length: 10 }, (_, i) =>
      ev(`ghost:${i}`, { tripId: 'T1', trainModel: 'E5' }),
    );
    expect(standingOf(summarizeCollection(legs, [JP]), 'E5')!.rideCount).toBe(1);
    const more = [...legs, ev('jp-a:0-1', { tripId: 'T2', trainModel: 'E5' })];
    expect(standingOf(summarizeCollection(more, [JP]), 'E5')!.rideCount).toBe(2);
  });

  it('trip-less events each bucket as their own solo:<id> trip', () => {
    const s = summarizeCollection(
      [ev('jp-a:0-1', { trainModel: 'E5' }), ev('jp-a:0-1', { trainModel: 'E5' })],
      [JP],
    );
    expect(standingOf(s, 'E5')!.rideCount).toBe(2);
  });

  it('a multi-model trip stands BOTH models with rideCount 1 each', () => {
    // WHY: trips legitimately carry multiple models (trips.ts trainModels is a Set by design) —
    // a 新幹線+特急 itinerary credits each card once, and the trip is NOT 未記録.
    const s = summarizeCollection(
      [
        ev('jp-a:0-1', { tripId: 'mm', trainModel: 'E5' }),
        ev('jp-b:0-1', { tripId: 'mm', trainModel: 'キハ261' }),
      ],
      [JP],
    );
    expect(standingOf(s, 'E5')!.rideCount).toBe(1);
    expect(standingOf(s, 'キハ261')!.rideCount).toBe(1);
    expect(s.unrecordedTripCount).toBe(0);
  });
});

describe('km + linesSeen — the ONLY resolution-gated fields (D16)', () => {
  it('sums seg.km over distinct (trip, segment) pairs: once within a trip, again on a new trip', () => {
    // WHY: diary semantics (a segment re-ridden on a later trip is a real ride), not coverage
    // dedupe — but a double-logged row inside one trip must not double the km.
    const within = summarizeCollection(
      [
        ev('jp-a:0-1', { tripId: 'T1', trainModel: 'E5' }),
        ev('jp-a:0-1', { tripId: 'T1', trainModel: 'E5' }), // dup row, same trip
      ],
      [JP],
    );
    expect(standingOf(within, 'E5')!.km).toBe(10.5);
    const across = summarizeCollection(
      [
        ev('jp-a:0-1', { tripId: 'T1', trainModel: 'E5' }),
        ev('jp-a:0-1', { tripId: 'T2', trainModel: 'E5' }), // same segment, new trip
      ],
      [JP],
    );
    expect(standingOf(across, 'E5')!.km).toBe(21);
  });

  it('rounds km to 2dp', () => {
    const s = summarizeCollection(
      [
        ev('jp-a:2-3', { tripId: 'T', trainModel: 'E5' }), // 1.111
        ev('jp-a:3-4', { tripId: 'T', trainModel: 'E5' }), // 2.222
      ],
      [JP],
    );
    expect(standingOf(s, 'E5')!.km).toBe(3.33);
  });

  it('collects linesSeen from resolved segments only, sorted', () => {
    const s = summarizeCollection(
      [
        ev('jp-b:0-1', { tripId: 'T', trainModel: 'E5' }),
        ev('jp-a:0-1', { tripId: 'T', trainModel: 'E5' }),
        ev('ghost:0-1', { tripId: 'T', trainModel: 'E5' }), // unresolved → contributes no line
      ],
      [JP],
    );
    expect(standingOf(s, 'E5')!.linesSeen).toEqual(['jp-a', 'jp-b']);
  });

  it('firstRidden/lastRidden read ev.date ?? createdAt day off RAW events — no segment gate', () => {
    const s = summarizeCollection(
      [
        ev('ghost:1', { trainModel: 'E5', date: '2026-03-05', createdAt: '2026-07-01T00:00:00.000Z' }),
        ev('ghost:2', { trainModel: 'E5', createdAt: '2026-07-02T12:34:56.000Z' }), // undated → createdAt day
      ],
      [JP],
    );
    const st = standingOf(s, 'E5')!;
    expect(st.firstRidden).toBe('2026-03-05');
    expect(st.lastRidden).toBe('2026-07-02');
  });
});

describe('D16 — membership from RAW events (deliberately diverges from trips.ts:121)', () => {
  it('kept-quarantine event (segment in NO package) keeps membership + milestones; km 0', () => {
    // WHY (3A): a 廃線 ride the user chose to keep must never vanish from the 図鑑 — matches
    // the closed-line honesty stance (its km proudly counts in coverage). Only km/linesSeen
    // degrade here; the standing, dates, and every milestone hold.
    const s = summarizeCollection(
      [ev('abolished:0-1', { tripId: 'q', trainModel: '500系', quarantine: 'kept', date: '2026-05-01' })],
      [JP],
    );
    const st = standingOf(s, '500')!;
    expect(st.rideCount).toBe(1);
    expect(st.km).toBe(0);
    expect(st.linesSeen).toEqual([]);
    expect(st.firstRidden).toBe('2026-05-01');
    const earned = earnedMilestoneIds(s);
    expect(earned).toContain('first-model');
    expect(earned).toContain('rode-retiring'); // 500系: retiresNote + still active
  });

  it('CN-404 degraded boot (only the JP package loads): CN membership, 日中両国, and the CN meter are UNCHANGED', () => {
    // WHY (3A): the corridor roster comes from the REGISTRY, not from loaded packages — a
    // package 404 must not un-earn a milestone or shrink either side of the meter. Only the
    // resolution-gated km degrades.
    const events = [
      ev('jp-a:0-1', { tripId: 'jp', trainModel: 'E5' }),
      ev('cn-jh:0-1', { tripId: 'cn', trainModel: 'CR400AF' }),
    ];
    const healthy = summarizeCollection(events, [JP, CN]);
    const degraded = summarizeCollection(events, [JP]);
    expect(degraded.totalModels).toBe(healthy.totalModels);
    expect(degraded.byCountry).toEqual(healthy.byCountry);
    expect(sectionOf(degraded, 'cn-hsr')!.meter).toEqual(sectionOf(healthy, 'cn-hsr')!.meter);
    expect(sectionOf(degraded, 'cn-hsr')!.meter).toEqual({
      collected: 1,
      total: 4,
      label: '京沪で会える車両',
    });
    expect(earnedMilestoneIds(degraded)).toContain('jp-cn-both');
    expect(standingOf(healthy, 'CR400AF')!.km).toBe(100);
    expect(standingOf(degraded, 'CR400AF')!.km).toBe(0);
  });

  it('orphaned segment (in no package, no quarantine flag) keeps membership the same way', () => {
    // WHY (3A): migration orphans are pending user decision — the model must not flicker
    // out of the 図鑑 while the row sits unresolved.
    const s = summarizeCollection([ev('orphan:0-1', { trainModel: 'E6' })], [JP]);
    expect(standingOf(s, 'E6')!.rideCount).toBe(1);
    expect(s.totalModels).toBe(1);
  });
});

describe('unrecordedTripCount (DD3 未記録 funnel)', () => {
  it('counts trips where NO row carries a model; solo rows bucket as solo:<id>; a partly-tagged trip is recorded', () => {
    const s = summarizeCollection(
      [
        // trip T1: two model-less rows → ONE unrecorded trip
        ev('jp-a:0-1', { tripId: 'T1' }),
        ev('jp-a:1-2', { tripId: 'T1' }),
        // two solo model-less rows → TWO unrecorded singleton trips
        ev('jp-b:0-1'),
        ev('jp-b:0-1'),
        // trip T2: one tagged + one blank row → the TRIP has a model → recorded
        ev('jp-a:0-1', { tripId: 'T2', trainModel: 'E5' }),
        ev('jp-a:1-2', { tripId: 'T2' }),
      ],
      [JP],
    );
    expect(s.unrecordedTripCount).toBe(3);
    expect(s.totalModels).toBe(1);
  });
});

describe('sections, ghosts, meters', () => {
  it('fixed section order; zero-state = the 5 registry sections (ghosts only), no その他', () => {
    const s = summarizeCollection([], [JP]);
    expect(s.sections.map((sec) => sec.category)).toEqual([
      'shinkansen',
      'cn-hsr',
      'ltd-express',
      'commuter',
      'dmu',
    ]);
    expect(s.totalModels).toBe(0);
    expect(s.sections.every((sec) => sec.collected.length === 0)).toBe(true);
    expect(s.byCountry).toEqual({ JP: 0, CN: 0, other: 0 });
  });

  it('cn-hsr ghosts are ONLY the corridor entries (registry order, 4 of them)', () => {
    // WHY (11B): the CN want-list must be earnable from the app's one corridor — ghosting
    // all-China would create a denominator the user can never complete.
    const s = summarizeCollection([], [JP]);
    const cn = sectionOf(s, 'cn-hsr')!;
    expect(cn.uncollected.map((e) => e.fold)).toEqual(['CR400AF', 'CR400BF', 'CRH380B', 'CRH380C']);
    expect(cn.meter).toEqual({ collected: 0, total: 4, label: '京沪で会える車両' });
  });

  it('inactive entries (E3) never ghost; a collected E3 renders as history OUTSIDE the meter', () => {
    // WHY (D2/D6): `active` gates the roster denominator only — retired stock is collected
    // history, not an uncompletable want-list entry, and never ticks X/N. (E2 moved BACK to
    // the active roster after the 2026-07 fact-check — E3 is the inactive fixture now.)
    const empty = summarizeCollection([], [JP]);
    const ghostFolds = sectionOf(empty, 'shinkansen')!.uncollected.map((e) => e.fold);
    expect(ghostFolds).toHaveLength(13);
    expect(ghostFolds).toContain('E2');
    expect(ghostFolds).not.toContain('E3');
    const withE3 = summarizeCollection([ev('jp-a:0-1', { trainModel: 'E3系' })], [JP]);
    const sec = sectionOf(withE3, 'shinkansen')!;
    expect(sec.collected.map((m) => m.fold)).toEqual(['E3']);
    expect(sec.meter).toEqual({ collected: 0, total: 13, label: '新幹線' });
    expect(sec.uncollected).toHaveLength(13); // ghost list unchanged by inactive collection
  });

  it('collected standings follow MODEL_REGISTRY declaration order inside a registry section', () => {
    // WHY: the grid is a stable 図鑑 page, not a recency feed — arrival order must not reorder it.
    const s = summarizeCollection(
      [
        ev('jp-a:0-1', { tripId: 'a', trainModel: 'E6' }),
        ev('jp-a:1-2', { tripId: 'b', trainModel: 'E5' }),
      ],
      [JP],
    );
    expect(sectionOf(s, 'shinkansen')!.collected.map((m) => m.fold)).toEqual(['E5', 'E6']);
  });

  it('NO meter on ltd-express / commuter / dmu / その他 (D6: open rosters have no denominator)', () => {
    const s = summarizeCollection([ev('jp-a:0-1', { trainModel: '謎の車両' })], [JP]);
    for (const cat of ['ltd-express', 'commuter', 'dmu', 'other']) {
      expect(sectionOf(s, cat)!.meter).toBeUndefined();
    }
    // …and the two closed, earnable rosters DO meter:
    expect(sectionOf(s, 'shinkansen')!.meter).toBeDefined();
    expect(sectionOf(s, 'cn-hsr')!.meter).toBeDefined();
  });
});

describe('deriveMilestones / earnedMilestoneIds (D11/DD15)', () => {
  const ACTIVE_SHINKANSEN = MODEL_REGISTRY.filter(
    (e) => e.category === 'shinkansen' && e.active,
  );

  it('always returns exactly the 5 stamps with pinned labels; empty log earns none', () => {
    // WHY (DD15): labels are the typographic stamps rendered verbatim — a drifted string is
    // a UI regression, so they are pinned byte-exact here.
    const empty = summarizeCollection([], [JP]);
    const ms = deriveMilestones(empty);
    expect(ms.map((m) => [m.id, m.label])).toEqual([
      ['first-model', '初車両'],
      ['shinkansen-complete', '新幹線コンプリート'],
      ['club-320', '320km/hクラブ'],
      ['jp-cn-both', '日中両国'],
      ['rode-retiring', '引退前に乗った'],
    ]);
    expect(ms.every((m) => !m.earned)).toBe(true);
    expect(earnedMilestoneIds(empty)).toEqual([]);
  });

  it('新幹線コンプリート flips exactly on the LAST active roster model (before/after the completing ride)', () => {
    // WHY: the roster is DATA (MODEL_REGISTRY), so the fixture derives it — only the count
    // (13 after the 2026-07 fact-check restored E2) is pinned. Membership needs no segment
    // resolution (D16), so the fixture rides unresolved segments on purpose.
    expect(ACTIVE_SHINKANSEN).toHaveLength(13);
    const allButOne = ACTIVE_SHINKANSEN.slice(0, -1).map((m, i) =>
      ev(`x:${i}`, { tripId: `t${i}`, trainModel: m.name }),
    );
    const total = ACTIVE_SHINKANSEN.length;
    const before = summarizeCollection(allButOne, [JP]);
    expect(sectionOf(before, 'shinkansen')!.meter).toEqual({ collected: total - 1, total, label: '新幹線' });
    expect(earnedMilestoneIds(before)).not.toContain('shinkansen-complete');
    const after = summarizeCollection(
      [...allButOne, ev('x:last', { tripId: 't-last', trainModel: ACTIVE_SHINKANSEN[total - 1].name })],
      [JP],
    );
    expect(sectionOf(after, 'shinkansen')!.meter).toEqual({ collected: total, total, label: '新幹線' });
    expect(earnedMilestoneIds(after)).toContain('shinkansen-complete');
  });

  it('club-320 needs a collected model with topSpeedKmh ≥ 320 — 800系 (260) does not qualify', () => {
    const slow = summarizeCollection([ev('jp-a:0-1', { trainModel: '800' })], [JP]);
    expect(earnedMilestoneIds(slow)).not.toContain('club-320');
    const fast = summarizeCollection([ev('jp-a:0-1', { trainModel: 'E5' })], [JP]);
    expect(earnedMilestoneIds(fast)).toContain('club-320');
  });

  it('rode-retiring needs retiresNote AND active — inactive E3 never earns it', () => {
    // WHY: the stamp means "you rode it BEFORE retirement"; an entry already outside the
    // active roster is history, not beating the clock. (E3 carries a retiresNote but
    // active:false; E2 — active WITH a note since the 2026-07 fact-check — DOES earn it.)
    const s = summarizeCollection([ev('jp-a:0-1', { trainModel: 'E3' })], [JP]);
    expect(earnedMilestoneIds(s)).toEqual(['first-model']);
    const active = summarizeCollection([ev('jp-a:0-1', { trainModel: 'E2' })], [JP]);
    expect(earnedMilestoneIds(active)).toEqual(['first-model', 'rode-retiring']);
  });

  it('日中両国 needs ≥1 registry model from EACH country — unknowns do not count as a country', () => {
    const jpOnly = summarizeCollection(
      [ev('jp-a:0-1', { trainModel: 'E5' }), ev('jp-b:0-1', { trainModel: '謎の車両' })],
      [JP],
    );
    expect(earnedMilestoneIds(jpOnly)).not.toContain('jp-cn-both');
  });
});
