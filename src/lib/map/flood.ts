// D5 — "the map floods green" signature motion.
//
// When litSegmentIds GROWS by many at once (an import), we don't snap the repaint: the
// newly-lit segments light up SEQUENTIALLY across the network in a wave. This file is the
// PURE brain of that beat (unit-tested): given the segments to add and their geometry, it
// produces a deterministic ORDER (a spatial sweep) and a frame SCHEDULE (which segments are
// lit at each animation tick). The Svelte/MapView side only calls setPaintProperty with the
// growing lit array each frame — no DOM/WebGL logic lives here.

import type { RailGeoPackage } from '../../contract/types';

/** Representative point of a segment (midpoint of its from/to seqs in WGS84 lon/lat). */
export interface SegPoint {
  segmentId: string;
  lon: number;
  lat: number;
}

/**
 * Midpoint of each segment in `pkg`, by segmentId — the sweep keys off these. Uses the
 * segment's own endpoint stations (no geometry re-measurement; just averages two points).
 */
export function segmentMidpoints(pkg: RailGeoPackage): Map<string, SegPoint> {
  const stationById = new Map(pkg.stations.map((s) => [s.stationId, s]));
  const out = new Map<string, SegPoint>();
  for (const seg of pkg.segments) {
    const a = stationById.get(seg.fromStationId);
    const b = stationById.get(seg.toStationId);
    if (!a || !b) continue;
    out.set(seg.segmentId, {
      segmentId: seg.segmentId,
      lon: (a.lon + b.lon) / 2,
      lat: (a.lat + b.lat) / 2,
    });
  }
  return out;
}

/**
 * Midpoints merged across EVERY loaded package — the map renders all packages in one style,
 * so the sweep needs one flat lookup. Later packages win a duplicate segmentId (packages are
 * disjoint by contract; the override is just deterministic tie-breaking). MapView calls this
 * at mount AND on every packages-store swap (the fallback-retry self-heal), so it lives here
 * where it's pure and unit-testable rather than inlined in the component.
 */
export function allSegmentMidpoints(packages: RailGeoPackage[]): Map<string, SegPoint> {
  const out = new Map<string, SegPoint>();
  for (const pkg of packages) for (const [k, v] of segmentMidpoints(pkg)) out.set(k, v);
  return out;
}

/**
 * Order the newly-lit segments into a wave. The wave sweeps along a diagonal axis
 * (south-west → north-east, i.e. increasing lon+lat) so the green visibly rolls across
 * the JP network rather than popping in. Deterministic: ties break on segmentId.
 *
 * Pure: takes the precomputed midpoints so it never touches geometry at runtime.
 */
export function floodOrder(newSegmentIds: string[], midpoints: Map<string, SegPoint>): string[] {
  const axis = (id: string): number => {
    const p = midpoints.get(id);
    return p ? p.lon + p.lat : Number.POSITIVE_INFINITY; // unknown points flush to the end
  };
  return [...new Set(newSegmentIds)].sort((a, b) => {
    const da = axis(a);
    const db = axis(b);
    return da === db ? a.localeCompare(b) : da - db;
  });
}

export interface FloodPlan {
  /** segments already lit before this flood — always present from frame 0. */
  base: string[];
  /** newly-lit segments in wave order. */
  wave: string[];
  /** number of animation frames (ticks). 1 means an instant repaint (reduced-motion). */
  frames: number;
  /** how many of `wave` are revealed cumulatively at each frame (length === frames). */
  cumulativeCounts: number[];
}

export interface FloodOptions {
  /** honor prefers-reduced-motion → collapse to a single instant frame. */
  reducedMotion?: boolean;
  /** max frames the wave may take (keeps a huge import from animating forever). */
  maxFrames?: number;
  /** segments revealed per frame at full speed (before the maxFrames clamp). */
  segmentsPerFrame?: number;
  /** below this many new segments, just snap (a 1–2 segment "import" isn't a flood). */
  minWaveSize?: number;
}

/**
 * Default wave threshold, EXPORTED so MapView's pulse() can key off the same number: a mark
 * of >= MIN_WAVE_SIZE new segments takes the flood path, and pulse must stay out of the
 * glow layer while a wave may be sweeping (they'd fight over line-opacity otherwise).
 */
export const MIN_WAVE_SIZE = 3;

const DEFAULTS = {
  maxFrames: 48,
  segmentsPerFrame: 6,
  minWaveSize: MIN_WAVE_SIZE,
} as const;

/**
 * Build the frame schedule for a flood. PURE — no timers. The caller drives it with
 * requestAnimationFrame (or setInterval) and reads `litAtFrame(plan, i)` per tick.
 *
 *  • reducedMotion OR wave smaller than minWaveSize  → a single instant frame (snap).
 *  • otherwise the wave reveals `segmentsPerFrame` segments/frame, clamped to maxFrames
 *    (so a 1,240-segment import still finishes in ~maxFrames ticks, segments-per-frame
 *    scaled up to fit).
 */
export function buildFloodPlan(
  baseLit: string[],
  newSegmentIds: string[],
  midpoints: Map<string, SegPoint>,
  opts: FloodOptions = {},
): FloodPlan {
  const maxFrames = opts.maxFrames ?? DEFAULTS.maxFrames;
  const perFrame = Math.max(1, opts.segmentsPerFrame ?? DEFAULTS.segmentsPerFrame);
  const minWaveSize = opts.minWaveSize ?? DEFAULTS.minWaveSize;

  // base excludes anything that is also in the wave (avoid double-listing).
  const newSet = new Set(newSegmentIds);
  const base = [...new Set(baseLit)].filter((id) => !newSet.has(id));
  const wave = floodOrder(newSegmentIds, midpoints);

  if (wave.length === 0) {
    return { base, wave, frames: 1, cumulativeCounts: [0] };
  }
  if (opts.reducedMotion || wave.length < minWaveSize) {
    return { base, wave, frames: 1, cumulativeCounts: [wave.length] };
  }

  // Frames = ceil(wave / perFrame), clamped to maxFrames. When clamped, we reveal more
  // per frame so the whole wave still lands by the last frame.
  const frames = Math.min(maxFrames, Math.ceil(wave.length / perFrame));
  const cumulativeCounts: number[] = [];
  for (let f = 1; f <= frames; f++) {
    const revealed = Math.min(wave.length, Math.round((wave.length * f) / frames));
    cumulativeCounts.push(revealed);
  }
  // Guarantee the final frame shows everything (rounding safety).
  cumulativeCounts[frames - 1] = wave.length;
  return { base, wave, frames, cumulativeCounts };
}

/** The full lit set at frame `i` (0-based): base + the first cumulativeCounts[i] of the wave. */
export function litAtFrame(plan: FloodPlan, i: number): string[] {
  const idx = Math.max(0, Math.min(plan.frames - 1, i));
  const count = plan.cumulativeCounts[idx];
  return [...plan.base, ...plan.wave.slice(0, count)];
}

/**
 * Detect a "flood" grow: which segmentIds are NEW in `next` vs `prev`. Returns an empty
 * array when nothing was added (a removal or no-op — caller just snaps). Used by MapView to
 * decide whether a litSegmentIds change warrants the wave vs a plain repaint.
 */
export function diffNewlyLit(prev: string[], next: string[]): string[] {
  const before = new Set(prev);
  const added: string[] = [];
  for (const id of next) if (!before.has(id)) added.push(id);
  return added;
}

/** SSR/test-safe prefers-reduced-motion probe. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Drive a flood plan with requestAnimationFrame, pacing it to ~`durationMs`. Calls
 * `onFrame(litIds, frameIndex, isLast)` each tick and resolves when done. Returns a
 * cancel function. Impure (timers) but trivial — the schedule itself is pure/tested.
 */
export function runFlood(
  plan: FloodPlan,
  onFrame: (litIds: string[], frameIndex: number, isLast: boolean) => void,
  durationMs = 1100,
): () => void {
  // Single-frame plan (snap): paint once, synchronously-ish.
  if (plan.frames <= 1) {
    onFrame(litAtFrame(plan, 0), 0, true);
    return () => {};
  }
  if (typeof requestAnimationFrame === 'undefined') {
    // Non-browser fallback: jump to final state.
    onFrame(litAtFrame(plan, plan.frames - 1), plan.frames - 1, true);
    return () => {};
  }
  let raf = 0;
  let cancelled = false;
  const start = performance.now();
  const perFrameMs = durationMs / plan.frames;
  let lastEmitted = -1;
  const tick = (now: number): void => {
    if (cancelled) return;
    const frame = Math.min(plan.frames - 1, Math.floor((now - start) / perFrameMs));
    if (frame !== lastEmitted) {
      lastEmitted = frame;
      onFrame(litAtFrame(plan, frame), frame, frame === plan.frames - 1);
    }
    if (frame >= plan.frames - 1) return;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
  };
}
