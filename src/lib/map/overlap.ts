// 共用区間 braid — pure detector + splitter (plan: docs/plans/overlap-braid.md, eng+design reviewed).
//
// Lines that share physical track (青函トンネル 新幹線↔海峡線, 成田空港線↔北総線, 関空連絡橋,
// 博多南線, 三田線↔南北線共用…) render stacked — identical geometry, so zoom never separates them.
// This module finds those shared RUNS and produces a per-segment render plan: the segment's
// coordinates split into pieces, each carrying a braid `slot` so the style can draw the lines
// side-by-side via data-driven `line-offset` (px, zoom-scaled — a geometric offset in meters would
// vanish at national zoom).
//
//   packages ─► computeOverlapPlan (memoized by packages identity, WeakMap)
//     │ 1. per-line bbox prefilter (~50m margin)               — 8A: skip far-apart lines
//     │ 2. quantize vertices to ~1e-4 (~11m) grid + neighbors  — 三田線↔南北線 share 0 exact vertices
//     │ 3. shared RUNS per segment vs partner lines            — min-run ≥3 consecutive shared
//     │    (gap-bridging: ≤2 unmatched vertices stay in-run)     vertices; plain crossings NEVER braid
//     │ 4. canonical run orientation + per-line parity sign    — 2A: 青函 traverses OPPOSITE directions;
//     │    (computed on the matched RUN's endpoints)             same slot sign would render stacked
//     │ 5. slots by (rank, lineId) — DD1: trunk line takes the
//     │    same side of every corridor nationwide; symmetric
//     │    centered values (2 lines → ±0.5; 3 → −1,0,+1)
//     │ 6. split coords: pre │ taper ×3 │ run │ taper ×3 │ post — 12A: STEPPED taper (line-offset is
//     │    (~80m steps at ±slot×⅓, ±slot×⅔)                      per-feature constant; 3 small kinks
//     ▼                                                          ≈1-2px each, round-join softened)
//   Map<segmentId, OverlapPiece[]>  — consumed by style.ts buildSegmentCollection
//
// SEAM INVARIANT (CRITICAL, tested): for every split segment, concat(pieces[i].coords) with shared
// boundary vertices === the original coordinates — zero dropped, zero duplicated interior vertices.
// (Prior learning loop-ring-reverse-then-slice: reverse-then-slice coordinate surgery drops closing
// edges; the tests pin this class.)
//
// FAIL-SAFE (DD3): callers wrap this in a try/catch — on ANY exception the map renders unbraided
// (empty plan). The braid is decoration; it must never break the map.

import type { RailGeoPackage } from '../../contract/types';

/** One render piece of a segment: a coordinate slice + its braid slot. */
export interface OverlapPiece {
  /** [lon, lat] slice; boundary vertices are SHARED with the adjacent piece (concat-dedup seam). */
  coords: [number, number][];
  /**
   * Braid slot in "strand units": 0 = true geometry; ±0.5 the two strands of a pair; taper pieces
   * carry ±slot×⅓ / ±slot×⅔. Rendered offset = slot × slotSpacingPx(zoom) (style.ts).
   */
  slot: number;
  /**
   * The reveal zoom (minz) of the corridor PARTNER line(s) — max over partners. The offset gates
   * on this (14A/DD2): a step→interpolate glide over [partnersMinz, partnersMinz+0.4] so a strand
   * never sits offset while its partner is LOD-hidden. 0 when slot === 0.
   */
  partnersMinz: number;
  /**
   * A representative segmentId of the corridor partner (DD4): the glow layer checks whether the
   * partner is ALSO ridden — both-ridden → glow renders CENTERED (offset 0) at 1/n opacity each,
   * summing to the network-standard glow; one-ridden → this strand's own offset glow at full
   * opacity. '' when slot === 0.
   */
  partnerSeg: string;
  /**
   * DD4 opacity share for the centered corridor glow: 1/n for an n-line corridor (0.5 for a pair),
   * so the n centered glows sum to the network-standard glow opacity. 1 when slot === 0.
   */
  glowShare: number;
}

/** segmentId → pieces. Segments absent from the map render as today (single feature, no braid). */
export type OverlapPlan = Map<string, OverlapPiece[]>;

/** ~1e-4° ≈ 11 m grid — the quantization that makes 三田線↔南北線-class corridors detectable. */
export const QUANTIZE_DEG = 1e-4;
/** A run must span ≥3 consecutive shared vertices — plain crossings (1-2) never braid. */
export const MIN_RUN_VERTICES = 3;
/** ≤2 unmatched vertices inside a run are bridged (mismatched vertex cadence tolerance). */
export const RUN_GAP_TOLERANCE = 2;
/** Taper step length target, meters (~3 steps ≈ 240 m per 12A). */
export const TAPER_STEP_M = 80;

/**
 * Compute the braid render plan for a package set. Pure; memoized by `packages` ARRAY IDENTITY
 * (same WeakMap idiom as style.ts segmentIndexCache — a fallback-retry self-heal that swaps the
 * array recomputes automatically). Returns an empty Map when nothing overlaps (CN-only, stub).
 */
export function computeOverlapPlan(packages: RailGeoPackage[]): OverlapPlan {
  let plan = planCache.get(packages);
  if (!plan) {
    plan = buildPlan(packages);
    planCache.set(packages, plan);
  }
  return plan;
}

const planCache = new WeakMap<RailGeoPackage[], OverlapPlan>();

function buildPlan(_packages: RailGeoPackage[]): OverlapPlan {
  // T1 implementation lands here (detector → runs → parity → slots → split).
  return new Map();
}
