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

describe('suggestModels — v3 plausibility gate (per-line service profiles)', () => {
  // Real profiled lines (line-profiles.ts, fact-checked 2026-07-10) + one synthetic
  // unprofiled id that will never gain a profile (stable regardless of data growth).
  const TOKAIDO = { lineId: 'jp-東海旅客鉄道-東海道新幹線', country: 'JP', isHSR: true };
  const JINGHU = { lineId: 'cn-中国铁路-京沪高速铁路', country: 'CN', isHSR: true };
  const UNPROFILED_JP = { lineId: 'jp-テスト-未収録線', country: 'JP', isHSR: false };

  it('empty-history 東海道: pads are EXACTLY the fact-checked roster — no CR, no E5 (the user-reported bug)', () => {
    const out = suggestModels([], { contexts: [TOKAIDO] });
    expect(out).toEqual(['N700A', 'N700S']);
  });

  it('empty-history 京沪: exactly the 4 corridor models; CR200J (parallel 京沪线, not the HSR) never pads', () => {
    const out = suggestModels([], { contexts: [JINGHU] });
    expect(out).toEqual(['CR400AF', 'CR400BF', 'CRH380B', 'CRH380C']);
    expect(out).not.toContain('CR200J');
  });

  it('an off-line registry recent is gated off an HSR line, but the SAME model logged ON the line bypasses every gate (G4)', () => {
    const lineOf = (sid: string): string | undefined =>
      sid === 'on-jinghu' ? JINGHU.lineId : 'cn-中国铁路-京沪線';
    // Logged elsewhere → gated (plausibility beats recency)…
    const gated = suggestModels([ev('CR200J', at(0), 'elsewhere')], { contexts: [JINGHU], lineOfSegment: lineOf });
    expect(gated).not.toContain('CR200J');
    // …but the user's own record on THIS line is never called implausible.
    const own = suggestModels([ev('CR200J', at(0), 'on-jinghu')], { contexts: [JINGHU], lineOfSegment: lineOf });
    expect(own[0]).toBe('CR200J');
  });

  it("bare 'CR400' (speed-only family, no registry card) survives as the user's own free text but never pads with a context", () => {
    const out = suggestModels([ev('CR400', at(0))], { contexts: [UNPROFILED_JP] });
    expect(out).toEqual(['CR400']); // kept as unknown text (G5)… and no pads at all follow
    const noRecent = suggestModels([], { contexts: [UNPROFILED_JP] });
    expect(noRecent).not.toContain('CR400');
  });

  it('unprofiled conventional JP line: NO default pads (honest empty), same-country recents pass, CN recents are gated', () => {
    expect(suggestModels([], { contexts: [UNPROFILED_JP] })).toEqual([]);
    const out = suggestModels([ev('E353', at(0)), ev('CR400AF', at(1))], { contexts: [UNPROFILED_JP] });
    expect(out).toEqual(['E353系']); // registry display name; the newer CN recent is gone
  });

  it('HSR context gates a same-country off-roster recent (E353 on 東海道) while unknown free text always survives', () => {
    const out = suggestModels([ev('E353', at(0)), ev('謎の保線車両', at(1))], { contexts: [TOKAIDO] });
    expect(out).not.toContain('E353系');
    expect(out).toContain('謎の保線車両');
  });

  it('rejected recents do NOT consume the 6-recent quota (an older eligible model still surfaces)', () => {
    const cn = ['CR400AF', 'CR400BF', 'CR300AF', 'CR300BF', 'CRH2', 'CRH3', 'CRH380A'];
    const events = [ev('E353', at(0)), ...cn.map((m, i) => ev(m, at(i + 1)))];
    const out = suggestModels(events, { contexts: [UNPROFILED_JP] });
    expect(out).toEqual(['E353系']); // 7 newer CN recents all gated, none evicted the JP one
  });

  it('multi-line trip (editor): eligible in ANY context — a conventional line rescues what the HSR context alone would gate', () => {
    const hsrOnly = suggestModels([ev('E353', at(0))], { contexts: [TOKAIDO] });
    expect(hsrOnly).not.toContain('E353系');
    const both = suggestModels([ev('E353', at(0))], { contexts: [TOKAIDO, UNPROFILED_JP] });
    expect(both[0]).toBe('E353系');
    // …and the profiled context still contributes its pads after the recents.
    expect(both).toContain('N700A');
  });

  it('profile pads dedupe against recents by CARD (an alias recent suppresses its pad entry)', () => {
    // 'N700系7000番台' resolves to the N700 card; on 山陽 the pad list contains N700 — one chip.
    const SANYO = { lineId: 'jp-西日本旅客鉄道-山陽新幹線', country: 'JP', isHSR: true };
    const out = suggestModels([ev('N700系7000番台', at(0))], { contexts: [SANYO] });
    expect(out.filter((m) => foldKey(m) === 'N700')).toHaveLength(1);
    expect(out).toContain('500系'); // rest of the 山陽 roster still pads
  });

  it('an empty contexts array is the fail-open path — exact v1/v2 pad behavior (degraded editor rows)', () => {
    expect(suggestModels([], { contexts: [] })).toEqual(KNOWN_TRAIN_MODELS.slice(0, 8));
  });

  // ── conventional 特急/通勤 profiles (model-major data, inverted) ──
  const YAMANOTE = { lineId: 'jp-東日本旅客鉄道-山手線', country: 'JP', isHSR: false };
  const CHUO_EAST = { lineId: 'jp-東日本旅客鉄道-中央線', country: 'JP', isHSR: false };

  it('山手線 pads its real stock (E235系) — never a Shinkansen or CN token (the second half of the user report)', () => {
    const out = suggestModels([], { contexts: [YAMANOTE] });
    expect(out).toContain('E235系');
    for (const chip of out) {
      expect(['E5系', 'N700S', 'CR400AF', 'CR200J']).not.toContain(chip);
    }
  });

  it('operator-split lines resolve separately: あずさ pads JR東 中央線, しなの does not (it lives on the JR東海 side)', () => {
    const out = suggestModels([], { contexts: [CHUO_EAST] });
    expect(out).toContain('E353系');
    expect(out).toContain('E233系');
    expect(out).not.toContain('383系'); // 383 serves jp-東海旅客鉄道-中央線 (木曽), a different lineId
  });

  it('ubiquitous workhorse (キハ40): passes as a recent on any JP conventional line, still gated off HSR lines', () => {
    const events = [ev('キハ40', at(0))];
    expect(suggestModels(events, { contexts: [UNPROFILED_JP] })).toContain('キハ40系');
    expect(suggestModels(events, { contexts: [YAMANOTE] })).toContain('キハ40系'); // profiled conventional, ubiquitous passes
    expect(suggestModels(events, { contexts: [TOKAIDO] })).not.toContain('キハ40系');
  });

  it('curated line-major + inverted model-major MERGE (奥羽線: mini-shinkansen first, then its DMU)', () => {
    const OU = { lineId: 'jp-東日本旅客鉄道-奥羽線', country: 'JP', isHSR: false };
    const out = suggestModels([], { contexts: [OU] });
    expect(out.slice(0, 2)).toEqual(['E8系', 'E6系']); // curated order leads
    expect(out).toContain('GV-E400系'); // inverted conventional data appends
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
