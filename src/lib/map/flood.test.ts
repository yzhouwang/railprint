import { describe, it, expect } from 'vitest';
import {
  segmentMidpoints,
  floodOrder,
  buildFloodPlan,
  litAtFrame,
  diffNewlyLit,
} from './flood';
import { JP_PACKAGE } from '../fallback-package';

describe('segmentMidpoints', () => {
  it('computes a midpoint per segment from its endpoint stations', () => {
    const mids = segmentMidpoints(JP_PACKAGE);
    expect(mids.size).toBe(JP_PACKAGE.segments.length);
    const seg = JP_PACKAGE.segments[0];
    const a = JP_PACKAGE.stations.find((s) => s.stationId === seg.fromStationId)!;
    const b = JP_PACKAGE.stations.find((s) => s.stationId === seg.toStationId)!;
    const p = mids.get(seg.segmentId)!;
    expect(p.lon).toBeCloseTo((a.lon + b.lon) / 2, 9);
    expect(p.lat).toBeCloseTo((a.lat + b.lat) / 2, 9);
  });
});

describe('floodOrder', () => {
  it('sweeps SW→NE (increasing lon+lat) and is deterministic', () => {
    const mids = segmentMidpoints(JP_PACKAGE);
    const ids = JP_PACKAGE.segments.map((s) => s.segmentId);
    const ordered = floodOrder(ids, mids);
    expect(ordered.length).toBe(ids.length);
    for (let i = 1; i < ordered.length; i++) {
      const prev = mids.get(ordered[i - 1])!;
      const cur = mids.get(ordered[i])!;
      expect(prev.lon + prev.lat).toBeLessThanOrEqual(cur.lon + cur.lat + 1e-9);
    }
    // deterministic: same input → same output
    expect(floodOrder(ids, mids)).toEqual(ordered);
  });

  it('dedupes and flushes unknown segments to the end', () => {
    const mids = segmentMidpoints(JP_PACKAGE);
    const known = JP_PACKAGE.segments[0].segmentId;
    const out = floodOrder([known, known, 'ghost:9-9'], mids);
    expect(out).toEqual([known, 'ghost:9-9']);
  });
});

describe('buildFloodPlan', () => {
  const mids = segmentMidpoints(JP_PACKAGE);

  it('snaps (1 frame, all lit) under reduced motion', () => {
    const wave = JP_PACKAGE.segments.slice(0, 20).map((s) => s.segmentId);
    const plan = buildFloodPlan([], wave, mids, { reducedMotion: true });
    expect(plan.frames).toBe(1);
    expect(plan.cumulativeCounts).toEqual([wave.length]);
    expect(litAtFrame(plan, 0).sort()).toEqual([...wave].sort());
  });

  it('snaps for a tiny wave (below minWaveSize)', () => {
    const wave = JP_PACKAGE.segments.slice(0, 2).map((s) => s.segmentId);
    const plan = buildFloodPlan([], wave, mids, { minWaveSize: 3 });
    expect(plan.frames).toBe(1);
    expect(litAtFrame(plan, 0)).toHaveLength(2);
  });

  it('animates a large wave with a monotonically growing, complete reveal', () => {
    const wave = JP_PACKAGE.segments.map((s) => s.segmentId);
    const plan = buildFloodPlan([], wave, mids, { segmentsPerFrame: 4, maxFrames: 48 });
    expect(plan.frames).toBeGreaterThan(1);
    expect(plan.cumulativeCounts.length).toBe(plan.frames);
    // monotonic non-decreasing
    for (let i = 1; i < plan.cumulativeCounts.length; i++) {
      expect(plan.cumulativeCounts[i]).toBeGreaterThanOrEqual(plan.cumulativeCounts[i - 1]);
    }
    // final frame reveals everything, in wave order
    expect(plan.cumulativeCounts[plan.frames - 1]).toBe(wave.length);
    expect(litAtFrame(plan, plan.frames - 1).sort()).toEqual([...wave].sort());
  });

  it('clamps frames for a huge import (perFrame scales up to fit maxFrames)', () => {
    // simulate 1,240 fake segments — only ordering count matters here
    const big = Array.from({ length: 1240 }, (_, i) => `fake:${i}-${i + 1}`);
    const plan = buildFloodPlan([], big, new Map(), {
      segmentsPerFrame: 1,
      maxFrames: 48,
    });
    expect(plan.frames).toBeLessThanOrEqual(48);
    expect(plan.cumulativeCounts[plan.frames - 1]).toBe(big.length);
  });

  it('keeps base lit from frame 0 and never double-lists wave members', () => {
    const base = [JP_PACKAGE.segments[0].segmentId];
    const wave = [JP_PACKAGE.segments[0].segmentId, ...JP_PACKAGE.segments.slice(1, 10).map((s) => s.segmentId)];
    const plan = buildFloodPlan(base, wave, mids, { reducedMotion: true });
    // base member that is also in wave must not appear twice in base
    expect(plan.base).not.toContain(JP_PACKAGE.segments[0].segmentId);
    const all = litAtFrame(plan, 0);
    expect(new Set(all).size).toBe(all.length);
  });

  it('empty wave → single empty frame', () => {
    const plan = buildFloodPlan(['a', 'b'], [], mids);
    expect(plan.frames).toBe(1);
    expect(litAtFrame(plan, 0).sort()).toEqual(['a', 'b']);
  });
});

describe('diffNewlyLit', () => {
  it('returns only ids present in next but not prev, preserving next order', () => {
    expect(diffNewlyLit(['a', 'b'], ['a', 'b', 'c', 'd'])).toEqual(['c', 'd']);
  });
  it('returns empty on a no-op or a removal', () => {
    expect(diffNewlyLit(['a', 'b'], ['a', 'b'])).toEqual([]);
    expect(diffNewlyLit(['a', 'b', 'c'], ['a'])).toEqual([]);
  });
});
