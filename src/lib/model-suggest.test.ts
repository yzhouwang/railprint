import { describe, expect, it } from 'vitest';
import type { RideEvent } from '../contract/types';
import { suggestModels } from './model-suggest';
import { KNOWN_TRAIN_MODELS, foldKey } from './train-models';

// model-suggest chips v2 (plan D8/5A/9A#4). The FIRST describe block is the migration
// safety net: MapView's v1 `modelSuggestions` $derived had NO test, so its semantics are
// pinned HERE before the wiring swaps over. Everything else pins the v2 upgrades
// (fold-dedupe, line-aware rank) and the O(events) single-pass budget.

let counter = 0;
function ev(
  trainModel: string | undefined,
  createdAt: string,
  segmentId = 'seg:0-1',
): RideEvent {
  return {
    id: `e${counter++}`,
    segmentId,
    railGeoVersion: 'jp-2025',
    source: 'manual',
    createdAt,
    trainModel,
  };
}

/** ISO timestamps that sort in call order — recency is the axis under test. */
const at = (i: number): string => new Date(Date.UTC(2025, 0, 1, 0, 0, 0, 0) + i * 1000).toISOString();

describe('suggestModels — v1 regression baseline (9A#4)', () => {
  it('no lineId, no fold-dupes: exactly top-6 recents by createdAt desc, then KNOWN pad to 8', () => {
    // 7 distinct UNKNOWN spellings (raw === rendered, so this pins v1 output verbatim);
    // logged oldest→newest, and the event array is deliberately NOT date-ordered (v1's
    // comment: $events is id-ordered) — shuffle to prove ranking reads createdAt, not index.
    const models = ['TEST1', 'TEST2', 'TEST3', 'TEST4', 'TEST5', 'TEST6', 'TEST7'];
    const events = models.map((m, i) => ev(m, at(i)));
    const shuffled = [events[3], events[6], events[0], events[4], events[1], events[5], events[2]];

    const out = suggestModels(shuffled);
    expect(out).toEqual([
      'TEST7', 'TEST6', 'TEST5', 'TEST4', 'TEST3', 'TEST2', // top-6 recents, newest first
      KNOWN_TRAIN_MODELS[0], KNOWN_TRAIN_MODELS[1],          // pad picks KNOWN[0..] in order
    ]);
    expect(out).toHaveLength(8);
  });

  it('pad skips known models already present as recents, preserving KNOWN array order', () => {
    // One recent that IS a known model: the pad must not repeat it, and must keep walking
    // KNOWN_TRAIN_MODELS in declaration order (the order chips users learned in v1).
    const out = suggestModels([ev(KNOWN_TRAIN_MODELS[0], at(0))]);
    expect(out[0]).toBe(KNOWN_TRAIN_MODELS[0]);
    expect(out.slice(1)).toEqual(
      KNOWN_TRAIN_MODELS.filter((m) => m !== KNOWN_TRAIN_MODELS[0]).slice(0, 7),
    );
    expect(new Set(out).size).toBe(8); // no duplicates
  });

  it('no events at all: pure KNOWN pad, first 8 in declaration order', () => {
    expect(suggestModels([])).toEqual(KNOWN_TRAIN_MODELS.slice(0, 8));
  });
});

describe('suggestModels — fold-dedupe (the E5/E5系 double-chip bug)', () => {
  it("'E5系' and 'E5' collapse to ONE chip, rendered as the registry name 'E5系'", () => {
    // Import path stores 'E5系', manual mark stores 'E5' — same fold ('E5'), one card.
    const out = suggestModels([ev('E5系', at(0)), ev('E5', at(1))]);
    expect(out.filter((m) => foldKey(m) === 'E5')).toHaveLength(1);
    expect(out[0]).toBe('E5系'); // registry display name, not whichever raw spelling was newest
    // ...and the KNOWN pad must not sneak 'E5' back in as a second chip.
    expect(out).not.toContain('E5');
  });

  it('a registry ALIAS fold and the card fold render the card once, and suppress its pad entry', () => {
    // 'N700系7000番台' is an alias of the N700 card — a DIFFERENT fold key that resolves to
    // the SAME card as 'N700'. Without display-level dedupe the card would chip twice (and
    // duplicate {#each (m)} keys downstream).
    const out = suggestModels([ev('N700', at(0)), ev('N700系7000番台', at(1))]);
    expect(out.filter((m) => m === 'N700系')).toHaveLength(1);
    expect(out.filter((m) => foldKey(m) === 'N700')).toHaveLength(1);
    expect(out).not.toContain('N700'); // pad entry suppressed by the recent
  });
});

describe('suggestModels — line-aware ranking (own history only)', () => {
  const lineOfSegment = (segmentId: string): string | undefined =>
    ({ s1: 'L1', s2: 'L2', s3: 'L1' } as Record<string, string>)[segmentId];

  it('a model logged on the selected line outranks a MORE RECENT model logged elsewhere', () => {
    const events = [
      ev('OLD-ON-L1', at(0), 's1'),
      ev('NEW-ELSEWHERE', at(1), 's2'),
    ];
    const withLine = suggestModels(events, { lineId: 'L1', lineOfSegment });
    expect(withLine[0]).toBe('OLD-ON-L1');
    expect(withLine[1]).toBe('NEW-ELSEWHERE');
  });

  it('line-matched models keep createdAt-desc order among themselves', () => {
    const events = [
      ev('OLD-ON-L1', at(0), 's1'),
      ev('NEW-ELSEWHERE', at(1), 's2'),
      ev('NEW-ON-L1', at(2), 's3'),
    ];
    const out = suggestModels(events, { lineId: 'L1', lineOfSegment });
    expect(out.slice(0, 3)).toEqual(['NEW-ON-L1', 'OLD-ON-L1', 'NEW-ELSEWHERE']);
  });

  it('falls back to pure recency without a lineId (and never calls the lookup)', () => {
    let calls = 0;
    const countingLookup = (segmentId: string): string | undefined => {
      calls++;
      return lineOfSegment(segmentId);
    };
    const events = [ev('OLD-ON-L1', at(0), 's1'), ev('NEW-ELSEWHERE', at(1), 's2')];
    const out = suggestModels(events, { lineOfSegment: countingLookup });
    expect(out.slice(0, 2)).toEqual(['NEW-ELSEWHERE', 'OLD-ON-L1']);
    expect(calls).toBe(0); // no selected line ⇒ zero lookup work
  });

  it('a lineId without a lineOfSegment resolver degrades to pure recency (no crash)', () => {
    const events = [ev('A1', at(0), 's1'), ev('B2', at(1), 's2')];
    expect(suggestModels(events, { lineId: 'L1' }).slice(0, 2)).toEqual(['B2', 'A1']);
  });
});

describe('suggestModels — cap and max', () => {
  /** 10 distinct unknown models, oldest→newest: recents can overflow the 6-slot window. */
  const tenRecents = (): RideEvent[] =>
    Array.from({ length: 10 }, (_, i) => ev(`MODEL${i}`, at(i)));

  it('default cap is 8: at most 6 recents, then KNOWN pad fills the rest', () => {
    const out = suggestModels(tenRecents());
    expect(out).toHaveLength(8);
    // Only the 6 NEWEST recents survive; slots 7-8 come from the pad even though 4 more
    // recents exist — the v1 "6 recents" rule, not "recents until full".
    expect(out.slice(0, 6)).toEqual(['MODEL9', 'MODEL8', 'MODEL7', 'MODEL6', 'MODEL5', 'MODEL4']);
    expect(out.slice(6)).toEqual(KNOWN_TRAIN_MODELS.slice(0, 2));
  });

  it('max below 6 truncates the recents themselves', () => {
    const out = suggestModels(tenRecents(), { max: 3 });
    expect(out).toEqual(['MODEL9', 'MODEL8', 'MODEL7']);
  });

  it('max above 8 keeps the 6-recent rule and pads deeper into KNOWN', () => {
    const out = suggestModels(tenRecents(), { max: 10 });
    expect(out).toHaveLength(10);
    expect(out.slice(0, 6)).toEqual(['MODEL9', 'MODEL8', 'MODEL7', 'MODEL6', 'MODEL5', 'MODEL4']);
    expect(out.slice(6)).toEqual(KNOWN_TRAIN_MODELS.slice(0, 4));
  });

  it('max 0 yields no chips', () => {
    expect(suggestModels(tenRecents(), { max: 0 })).toEqual([]);
  });
});

describe('suggestModels — raw spellings and empty fields', () => {
  it('unknown free text renders VERBATIM in its MOST RECENT spelling (その他 is first-class)', () => {
    // Same fold ('DOCTORYELLOW'), two user spellings — the chip shows the newer one, never a
    // normalized/uppercased form (stored strings are display strings for unknowns, plan D6).
    const out = suggestModels([ev('doctor yellow', at(0)), ev('Doctor Yellow', at(1))]);
    expect(out[0]).toBe('Doctor Yellow');
    expect(out.filter((m) => foldKey(m) === 'DOCTORYELLOW')).toHaveLength(1);
  });

  it('events without a trainModel (or whitespace-only) contribute nothing', () => {
    const out = suggestModels([
      ev(undefined, at(0)),
      ev('', at(1)),
      ev('   ', at(2)), // trims to nothing — no signal, must not become a blank chip
    ]);
    expect(out).toEqual(KNOWN_TRAIN_MODELS.slice(0, 8));
  });
});

describe('suggestModels — benchmark-style guard (O(events) single pass)', () => {
  it('5k events rank correctly within the regression-guard budget (<50ms best-of-3)', () => {
    // 5k events cycling 20 models on 20 segments (model index == segment index), timestamps
    // strictly increasing. Even-indexed segments sit on L1 → with lineId 'L1' the top-6 must
    // be the even models by latest-use desc, then the KNOWN pad. The EXACT expected array is
    // computable by hand, so this doubles as a large-scale correctness check — a full-log
    // sort that broke tie/ordering behavior, or a rank bug, fails the equality before the
    // budget ever matters.
    const events: RideEvent[] = [];
    for (let i = 0; i < 5000; i++) {
      events.push(ev(`M${i % 20}`, at(i), `seg${i % 20}`));
    }
    const lineOfSegment = (segmentId: string): string | undefined =>
      Number(segmentId.slice(3)) % 2 === 0 ? 'L1' : 'L2';

    // Best-of-3 (braid-detector precedent, overlap.bench.test.ts): a single sample is a flake
    // surface — one GC pause on a noisy CI runner would fail a healthy build. The budget is a
    // LOOSE regression guard against accidental O(n log n)-on-the-whole-log or worse; the
    // logged ms is the fine-grained signal.
    let ms = Infinity;
    let out: string[] = [];
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      out = suggestModels(events, { lineId: 'L1', lineOfSegment });
      ms = Math.min(ms, performance.now() - start);
    }
    // Last occurrence of M_k is i = 4980 + k, so latest-use desc = M19, M18, …; filtering to
    // L1 (even k) gives M18, M16, M14, M12, M10, M8 as the six recents.
    expect(out).toEqual([
      'M18', 'M16', 'M14', 'M12', 'M10', 'M8',
      KNOWN_TRAIN_MODELS[0], KNOWN_TRAIN_MODELS[1],
    ]);
    // eslint-disable-next-line no-console
    console.log(`suggestModels(5k events, line-aware) took ${ms.toFixed(2)} ms (budget <50 ms)`);
    expect(ms).toBeLessThan(250); // generous: guards O(events) regressions, not CI scheduling noise
  });
});
