import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  computeOverlapPlan,
  QUANTIZE_DEG,
  MIN_RUN_VERTICES,
  type OverlapPiece,
} from './overlap';
import type { RailGeoPackage, RailLine, RailSegment, RailStation } from '../../contract/types';

// Synthetic package builder (route.test/marking.test idiom): each line is a vertex chain; braid
// behavior is controlled by literally placing vertices on/near the partner's coordinates.
// ~1e-4° ≈ 11m; vertices are spaced ~300m (3e-3 lon) so taper cuts (~80m) land inside runs only
// when we densify deliberately.
interface LineDef {
  lineId: string;
  rank?: 0 | 1 | 2 | 3 | 4;
  coords: [number, number][]; // single segment per line unless split via `segsAt`
  segsAt?: number[]; // optional vertex indices where the line breaks into separate segments
}
function pkgFromLines(defs: LineDef[]): RailGeoPackage {
  const lines: RailLine[] = [];
  const stations: RailStation[] = [];
  const segments: RailSegment[] = [];
  for (const def of defs) {
    lines.push({
      lineId: def.lineId,
      name: def.lineId,
      country: 'JP',
      isHSR: false,
      isLoop: false,
      ...(def.rank !== undefined ? { rank: def.rank } : {}),
      stationOrder: [],
      geometry: { type: 'LineString', coordinates: def.coords },
    });
    const breaks = [0, ...(def.segsAt ?? []), def.coords.length - 1];
    for (let s = 0; s < breaks.length - 1; s++) {
      const from = breaks[s];
      const to = breaks[s + 1];
      segments.push({
        segmentId: `${def.lineId}:${s}-${s + 1}`,
        lineId: def.lineId,
        fromStationId: `${def.lineId}.${s}`,
        toStationId: `${def.lineId}.${s + 1}`,
        fromSeq: s,
        toSeq: s + 1,
        km: 1,
        isHSR: false,
        geometry: { type: 'LineString', coordinates: def.coords.slice(from, to + 1) },
      });
    }
  }
  return { version: 'test-overlap.1', generatedAt: '2026-07-06T00:00:00.000Z', crs: 'WGS84', country: 'JP', lines, segments, stations };
}
/** A straight chain of n vertices from [lon0, lat], stepping +stepLon each. */
function chain(n: number, lon0 = 139, lat = 35, stepLon = 3e-3): [number, number][] {
  return Array.from({ length: n }, (_, i) => [lon0 + i * stepLon, lat]);
}
const seamOk = (original: [number, number][], pieces: OverlapPiece[]): boolean => {
  // CRITICAL seam invariant: concat with shared-boundary dedup === original, nothing dropped/dup'd.
  const joined: [number, number][] = [];
  for (const [i, p] of pieces.entries()) joined.push(...(i === 0 ? p.coords : p.coords.slice(1)));
  return JSON.stringify(joined) === JSON.stringify(original);
};

describe('computeOverlapPlan — detection', () => {
  it('#1 bit-identical full-line twins (青函-shaped) braid with symmetric ±0.5 slots', () => {
    const coords = chain(8);
    const pkg = pkgFromLines([
      { lineId: 'a-line', rank: 0, coords },
      { lineId: 'b-line', rank: 3, coords: [...coords] },
    ]);
    const plan = computeOverlapPlan([pkg]);
    const a = plan.get('a-line:0-1')!;
    const b = plan.get('b-line:0-1')!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // full-run twins (runs reach both segment endpoints) → single full-slot piece each, no tapers
    expect(a).toHaveLength(1);
    expect(Math.abs(a[0].slot)).toBe(0.5);
    expect(Math.abs(b[0].slot)).toBe(0.5);
  });

  it('#2 ~11m-quantized near-miss pair (三田線-shaped) still braids', () => {
    const coords = chain(8);
    const nudged = coords.map(([x, y]) => [x + QUANTIZE_DEG * 0.4, y + QUANTIZE_DEG * 0.4] as [number, number]);
    const plan = computeOverlapPlan([pkgFromLines([
      { lineId: 'x-line', coords },
      { lineId: 'y-line', coords: nudged },
    ])]);
    expect(plan.get('x-line:0-1')).toBeDefined();
    expect(plan.get('y-line:0-1')).toBeDefined();
  });

  it('#3 disjoint lines (bbox prefilter path) → empty plan', () => {
    const plan = computeOverlapPlan([pkgFromLines([
      { lineId: 'tokyo', coords: chain(6, 139, 35) },
      { lineId: 'osaka', coords: chain(6, 135, 34) },
    ])]);
    expect(plan.size).toBe(0);
  });

  it('#4 overlapping bboxes but no shared vertices → empty plan', () => {
    const plan = computeOverlapPlan([pkgFromLines([
      { lineId: 'north', coords: chain(6, 139, 35.02) }, // ~2km apart: same bbox zone, no cell hits
      { lineId: 'south', coords: chain(6, 139, 35.0) },
    ])]);
    expect(plan.size).toBe(0);
  });

  it('#5 min-run guard: a plain crossing (1 shared vertex) never braids', () => {
    const h: [number, number][] = chain(7, 139, 35);
    const v: [number, number][] = Array.from({ length: 7 }, (_, i) => [139 + 3 * 3e-3, 35 - 3 * 3e-3 + i * 3e-3]);
    // v crosses h at exactly one vertex (h[3] === v[3])
    const plan = computeOverlapPlan([pkgFromLines([
      { lineId: 'horiz', coords: h },
      { lineId: 'vert', coords: v },
    ])]);
    expect(plan.size).toBe(0);
    expect(MIN_RUN_VERTICES).toBeGreaterThanOrEqual(3);
  });

  it('#6 gap-bridging: ≤2 unmatched vertices inside a run stay in-run (cadence mismatch)', () => {
    const coords = chain(10);
    const partner = [...coords];
    partner[4] = [coords[4][0], coords[4][1] + 30 * QUANTIZE_DEG]; // one vertex pulled ~330m off
    const plan = computeOverlapPlan([pkgFromLines([
      { lineId: 'main', coords },
      { lineId: 'off', coords: partner },
    ])]);
    // still ONE run (bridged), not two fragments
    const pieces = plan.get('main:0-1')!;
    expect(pieces).toBeDefined();
    expect(pieces.filter((p) => p.slot !== 0)).toHaveLength(1);
  });

  it('#15 CN-like package with no corridors → empty plan, and memo returns the same object', () => {
    const pkg = pkgFromLines([{ lineId: 'solo', coords: chain(6) }]);
    const arr = [pkg];
    const p1 = computeOverlapPlan(arr);
    expect(p1.size).toBe(0);
    expect(computeOverlapPlan(arr)).toBe(p1); // #13 determinism/memo by identity
  });
});

describe('computeOverlapPlan — parity + slots (DD1/2A)', () => {
  it('#9 opposite-direction pair (青函 verified case) gets OPPOSITE effective sides via SAME-parity math', () => {
    const coords = chain(8);
    const reversed = [...coords].reverse();
    const plan = computeOverlapPlan([pkgFromLines([
      { lineId: 'fwd', rank: 0, coords },
      { lineId: 'rev', rank: 3, coords: reversed },
    ])]);
    const f = plan.get('fwd:0-1')![0];
    const r = plan.get('rev:0-1')![0];
    // Same-direction pairs need opposite slot signs; opposite-direction pairs need the SAME sign
    // (line-offset is right-of-travel). Parity normalization: slot × parity. fwd traverses the run
    // canonically (parity +1), rev anti-canonically (parity −1) — so DD1's +0.5 trunk / −0.5 local
    // become +0.5 and +0.5 here. The invariant to pin: parity FLIPPED exactly one of them.
    expect(f.slot * r.slot).toBeGreaterThan(0); // same sign ⇒ geographically opposite sides
  });

  it('#10 same-direction pair (成田 verified case) gets opposite slot signs', () => {
    const coords = chain(8);
    const plan = computeOverlapPlan([pkgFromLines([
      { lineId: 'trunk', rank: 0, coords },
      { lineId: 'local', rank: 3, coords: [...coords] },
    ])]);
    const t = plan.get('trunk:0-1')![0];
    const l = plan.get('local:0-1')![0];
    expect(t.slot * l.slot).toBeLessThan(0); // opposite signs ⇒ opposite sides
  });

  it('#11 3-line corridor gets centered slots {−1, 0, +1}', () => {
    const coords = chain(8);
    const plan = computeOverlapPlan([pkgFromLines([
      { lineId: 'a3', rank: 0, coords },
      { lineId: 'b3', rank: 2, coords: [...coords] },
      { lineId: 'c3', rank: 4, coords: [...coords] },
    ])]);
    const slots = ['a3:0-1', 'b3:0-1', 'c3:0-1'].map((id) => plan.get(id)![0].slot).sort((x, y) => x - y);
    expect(slots).toEqual([-1, 0, 1]);
  });

  it('DD1: the trunk (lowest rank) takes the positive canonical side; ties break by lineId', () => {
    const coords = chain(8);
    const plan = computeOverlapPlan([pkgFromLines([
      { lineId: 'zzz-trunk', rank: 0, coords },
      { lineId: 'aaa-local', rank: 4, coords: [...coords] },
    ])]);
    // both traverse canonically (parity +1) → trunk slot must be the positive one despite 'zzz' > 'aaa'
    expect(plan.get('zzz-trunk:0-1')![0].slot).toBe(0.5);
    expect(plan.get('aaa-local:0-1')![0].slot).toBe(-0.5);
  });

  it('#14 slot symmetry: Σ slots over a corridor ≈ 0 (per traversal-parity group)', () => {
    const coords = chain(8);
    const plan = computeOverlapPlan([pkgFromLines([
      { lineId: 'p', rank: 1, coords },
      { lineId: 'q', rank: 2, coords: [...coords] },
    ])]);
    const sum = plan.get('p:0-1')![0].slot + plan.get('q:0-1')![0].slot;
    expect(sum).toBe(0);
  });

  it('partnersMinz carries the PARTNER line reveal zoom (14A gate input) + glowShare = 1/n (DD4)', () => {
    const coords = chain(8);
    const plan = computeOverlapPlan([pkgFromLines([
      { lineId: 'shin', rank: 0, coords }, // minz 3
      { lineId: 'loc', rank: 4, coords: [...coords] }, // minz 7
    ])]);
    const shin = plan.get('shin:0-1')![0];
    const loc = plan.get('loc:0-1')![0];
    expect(shin.partnersMinz).toBe(7); // the trunk waits for the LOCAL to reveal
    expect(loc.partnersMinz).toBe(3);
    expect(shin.glowShare).toBe(0.5);
    expect(shin.partnerSeg).toBe('loc:0-1');
    expect(loc.partnerSeg).toBe('shin:0-1');
  });
});

describe('computeOverlapPlan — splitting + tapers (3B/12A) + CRITICAL seams', () => {
  // A partial-run fixture: partner shares only the MIDDLE of the segment, with dense vertices
  // (~55m apart) so the two-cut taper ladders (~80m steps) fit inside the run.
  function partialFixture(): { pkg: RailGeoPackage; coords: [number, number][] } {
    const dense = 5e-4; // ≈55m per step
    const coords: [number, number][] = Array.from({ length: 40 }, (_, i) => [139 + i * dense, 35]);
    const partner = coords.slice(10, 30); // shares vertices 10..29 only
    const pkg = pkgFromLines([
      { lineId: 'through', rank: 1, coords },
      { lineId: 'shared', rank: 3, coords: partner },
    ]);
    return { pkg, coords };
  }

  it('#7 partial mid-segment run → pre/taper/core/taper/post pieces with fractional slots', () => {
    const { pkg } = partialFixture();
    const plan = computeOverlapPlan([pkg]);
    const pieces = plan.get('through:0-1')!;
    expect(pieces.length).toBeGreaterThanOrEqual(5); // pre + (2 in-taper) + core + (2 out-taper) + post
    const slots = pieces.map((p) => Math.abs(p.slot));
    expect(slots[0]).toBe(0); // pre
    expect(slots[slots.length - 1]).toBe(0); // post
    const core = Math.max(...slots);
    expect(core).toBe(0.5);
    // taper fractions present strictly between 0 and core (#12)
    expect(slots.some((s) => s > 0 && s < core)).toBe(true);
  });

  it('#8 CRITICAL seam invariant: concat(pieces) === original coords, zero dropped/duplicated', () => {
    const { pkg, coords } = partialFixture();
    const plan = computeOverlapPlan([pkg]);
    expect(seamOk(coords, plan.get('through:0-1')!)).toBe(true);
    // and for the full-twin case too
    const full = chain(8);
    const plan2 = computeOverlapPlan([pkgFromLines([
      { lineId: 'fa', coords: full },
      { lineId: 'fb', coords: [...full] },
    ])]);
    expect(seamOk(full, plan2.get('fa:0-1')!)).toBe(true);
  });

  it('#12 taper pieces carry intermediate slot values (⅓, ⅔ ladder)', () => {
    const { pkg } = partialFixture();
    const pieces = computeOverlapPlan([pkg]).get('through:0-1')!;
    const fracs = pieces.map((p) => Math.abs(p.slot)).filter((s) => s > 0 && s < 0.5);
    expect(fracs.length).toBeGreaterThanOrEqual(2);
    for (const f of fracs) {
      expect([1 / 6, 1 / 3].some((v) => Math.abs(f - v) < 1e-9)).toBe(true); // 0.5×⅓, 0.5×⅔
    }
  });

  it('run at segment endpoints (full twin) gets NO taper — the mouth is a station (3B)', () => {
    const full = chain(8);
    const pieces = computeOverlapPlan([pkgFromLines([
      { lineId: 'ga', coords: full },
      { lineId: 'gb', coords: [...full] },
    ])]).get('ga:0-1')!;
    expect(pieces).toHaveLength(1);
    expect(Math.abs(pieces[0].slot)).toBe(0.5);
  });

  it('non-corridor props are inert: plain pieces carry slot 0 / glowShare 1 / empty partnerSeg', () => {
    const { pkg } = partialFixture();
    const pieces = computeOverlapPlan([pkg]).get('through:0-1')!;
    const plain = pieces[0];
    expect(plain.slot).toBe(0);
    expect(plain.partnerSeg).toBe('');
    expect(plain.glowShare).toBe(1);
    expect(plain.partnersMinz).toBe(0);
  });
});

describe('computeOverlapPlan — review-hardening edges (gap boundary, multi-run, crossed ladders)', () => {
  it('gap boundary: exactly 2 unmatched vertices still bridge into ONE run', () => {
    const coords = chain(12);
    const partner = [...coords];
    partner[4] = [coords[4][0], coords[4][1] + 30 * QUANTIZE_DEG];
    partner[5] = [coords[5][0], coords[5][1] + 30 * QUANTIZE_DEG];
    const pieces = computeOverlapPlan([pkgFromLines([
      { lineId: 'g2-main', coords },
      { lineId: 'g2-off', coords: partner },
    ])]).get('g2-main:0-1')!;
    expect(pieces.filter((p) => p.slot !== 0)).toHaveLength(1);
    expect(seamOk(coords, pieces)).toBe(true);
  });

  it('gap boundary: 3 unmatched vertices SPLIT the run (two offset runs, seams hold)', () => {
    const coords = chain(14);
    const partner = [...coords];
    for (const i of [5, 6, 7]) partner[i] = [coords[i][0], coords[i][1] + 30 * QUANTIZE_DEG];
    const pieces = computeOverlapPlan([pkgFromLines([
      { lineId: 'g3-main', coords },
      { lineId: 'g3-off', coords: partner },
    ])]).get('g3-main:0-1')!;
    expect(pieces.filter((p) => p.slot !== 0).length).toBeGreaterThanOrEqual(2);
    expect(seamOk(coords, pieces)).toBe(true);
  });

  it('two disjoint runs in ONE segment: inter-run stitching + CRITICAL seam invariant', () => {
    const dense = 5e-4;
    const coords: [number, number][] = Array.from({ length: 40 }, (_, i) => [139 + i * dense, 35]);
    const pkg = pkgFromLines([
      { lineId: 'tworun-main', coords },
      { lineId: 'tworun-p1', coords: coords.slice(5, 13) },
      { lineId: 'tworun-p2', coords: coords.slice(25, 33) },
    ]);
    const pieces = computeOverlapPlan([pkg]).get('tworun-main:0-1')!;
    const offset = pieces.filter((p) => p.slot !== 0);
    expect(offset.length).toBeGreaterThanOrEqual(2);
    // the two runs braid against DIFFERENT partners — per-run reps must name each one
    const reps = new Set(offset.map((p) => p.partnerSeg.split(':')[0]));
    expect(reps.has('tworun-p1')).toBe(true);
    expect(reps.has('tworun-p2')).toBe(true);
    expect(seamOk(coords, pieces)).toBe(true);
  });

  it('crossed taper ladders (short dense run) degrade to a plain jump — seams hold', () => {
    const dense = 5e-4; // ~55m spacing: ladders (~2×80m each side) cannot both fit a short run
    const coords: [number, number][] = Array.from({ length: 24 }, (_, i) => [139 + i * dense, 35]);
    const partner = coords.slice(9, 15); // 6-vertex shared run ≈ 275m < 2 full ladders
    const pieces = computeOverlapPlan([pkgFromLines([
      { lineId: 'short-main', coords },
      { lineId: 'short-p', coords: partner },
    ])]).get('short-main:0-1')!;
    const offset = pieces.filter((p) => p.slot !== 0);
    expect(offset.length).toBeGreaterThanOrEqual(1);
    // no fractional taper slots when the ladders would cross — full slot only
    for (const p of offset) expect(Math.abs(p.slot)).toBe(0.5);
    expect(seamOk(coords, pieces)).toBe(true);
  });

  it('15A/#8 continuity: adjacent same-membership segments get identical slot values', () => {
    const coords = chain(13);
    const plan = computeOverlapPlan([pkgFromLines([
      { lineId: 'cont-a', rank: 0, coords, segsAt: [6] },
      { lineId: 'cont-b', rank: 3, coords: [...coords], segsAt: [6] },
    ])]);
    const a1 = plan.get('cont-a:0-1')![0].slot;
    const a2 = plan.get('cont-a:1-2')![0].slot;
    expect(a1).toBe(a2); // the trunk keeps its side across the segment boundary
  });

  it('partnerSeg2: 3-line corridor pieces carry BOTH partner reps; pairs carry none', () => {
    const coords = chain(8);
    const plan = computeOverlapPlan([pkgFromLines([
      { lineId: 'p2-a', rank: 0, coords },
      { lineId: 'p2-b', rank: 2, coords: [...coords] },
      { lineId: 'p2-c', rank: 4, coords: [...coords] },
    ])]);
    const aPiece = plan.get('p2-a:0-1')![0];
    expect(aPiece.partnerSeg).not.toBe('');
    expect(aPiece.partnerSeg2).not.toBe('');
    expect(aPiece.partnerSeg).not.toBe(aPiece.partnerSeg2);
    expect(aPiece.glowShare).toBeCloseTo(1 / 3);
    // the slot-0 CENTER strand is a corridor member too (the style regression pins prop emission)
    const centre = [...plan.entries()].map(([, ps]) => ps[0]).find((p) => p.slot === 0 && p.partnerSeg !== '');
    expect(centre).toBeDefined();
    const pair = computeOverlapPlan([pkgFromLines([
      { lineId: 'pp-a', coords },
      { lineId: 'pp-b', coords: [...coords] },
    ])]).get('pp-a:0-1')![0];
    expect(pair.partnerSeg2).toBe('');
  });
});

describe('computeOverlapPlan — red-team regressions (parity jitter, rings, real-package pins)', () => {
  it('N-S corridor with sub-cell endpoint lon jitter: partners still take OPPOSITE sides', () => {
    // A north-south chain whose endpoint lons differ by less than a quantize cell in OPPOSITE
    // orders per line — raw lon-first lex orientation would disagree between the partners and
    // collide both strands on one side; dominant-axis quantized orientation must not.
    const ns = (jitter: number): [number, number][] =>
      Array.from({ length: 8 }, (_, i) => [139 + (i === 7 ? jitter : 0), 35 + i * 3e-3]);
    const plan = computeOverlapPlan([pkgFromLines([
      { lineId: 'ns-a', rank: 0, coords: ns(QUANTIZE_DEG * 0.3) },
      { lineId: 'ns-b', rank: 3, coords: ns(-QUANTIZE_DEG * 0.3) },
    ])]);
    const a = plan.get('ns-a:0-1')![0];
    const b = plan.get('ns-b:0-1')![0];
    // same traversal direction ⇒ opposite slot signs (the separation condition)
    expect(a.slot * b.slot).toBeLessThan(0);
  });

  it('degenerate ring run (endpoints in one cell) renders UNBRAIDED, never a same-side guess', () => {
    const ring: [number, number][] = [
      [139, 35], [139.003, 35], [139.003, 35.003], [139, 35.003], [139, 35],
    ];
    const plan = computeOverlapPlan([pkgFromLines([
      { lineId: 'ring-a', coords: ring },
      { lineId: 'ring-b', coords: [...ring] },
    ])]);
    for (const key of ['ring-a:0-1', 'ring-b:0-1']) {
      const pieces = plan.get(key);
      if (pieces) for (const p of pieces) expect(p.slot).toBe(0);
    }
  });

  it('real-package pin: the marquee corridors braid; the pair population stays sane', () => {
    // A data-refresh canary (red-team): new false-positive pairs surface here instead of silently
    // shipping. Marquee pairs must braid; the total braided-segment count stays within a band.
    const jp = JSON.parse(readFileSync('public/rail/jp-2025.json', 'utf8')) as RailGeoPackage;
    const plan = computeOverlapPlan([jp]);
    const segLine = new Map(jp.segments.map((s) => [s.segmentId, s.lineId]));
    const braidedLines = new Set([...plan.keys()].map((sid) => segLine.get(sid)!));
    for (const marquee of [
      'jp-北海道旅客鉄道-北海道新幹線',
      'jp-北海道旅客鉄道-海峡線',
      'jp-京成電鉄-成田空港線',
      'jp-北総鉄道-北総線',
      'jp-東京都-6号線三田線',
    ]) {
      expect(braidedLines.has(marquee), `${marquee} must braid`).toBe(true);
    }
    expect(plan.size).toBeGreaterThan(100);
    expect(plan.size).toBeLessThan(400);
  });
});
