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

import type { RailGeoPackage, RailLine, RailSegment } from '../../contract/types';
import { minzForRank } from './lod';

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
   * A representative segmentId of the corridor partner (DD4), resolved AT THE RUN's start vertex
   * so it names the partner segment actually shared here: the glow layer checks whether every
   * partner is ALSO ridden — all-ridden → glow renders CENTERED (offset 0) at 1/n opacity each,
   * summing to the network-standard glow; otherwise → this strand's own offset glow at full
   * opacity. '' on plain (non-corridor) pieces — the discriminator style.ts keys on.
   */
  partnerSeg: string;
  /**
   * Second representative partner for 3-line corridors; '' on pairs and plain pieces. Corridors
   * of 4+ lines (none known in the data) still braid correctly — slots handle any n — but the
   * all-partners glow check tops out at two ids, so their centered halo can fire early.
   */
  partnerSeg2: string;
  /**
   * DD4 opacity share for the centered corridor glow: 1/n for an n-line corridor (0.5 for a pair,
   * ⅓ on every strand of a triple INCLUDING the slot-0 center). 1 on plain pieces.
   */
  glowShare: number;
}

/** segmentId → pieces. Segments absent from the map render as today (single feature, no braid). */
export type OverlapPlan = Map<string, OverlapPiece[]>;

/** ~1e-4° ≈ 11 m grid — the quantization that makes 三田線↔南北線-class corridors detectable. */
export const QUANTIZE_DEG = 1e-4;
/** A run must span ≥3 consecutive shared vertices — plain crossings (1-2) never braid. */
export const MIN_RUN_VERTICES = 3;
/** ≤4 unmatched vertices inside a run are bridged — with vertex→edge matching an unmatched
 *  vertex means the track genuinely diverges >~16m there; brief divergences are sub-pixel at
 *  braid zooms and splitting on them shreds the corridor into misaligned fragments. */
export const RUN_GAP_TOLERANCE = 4;
/** Bridging budget: a single bridged hop may span up to HOP m (sparse tunnels digitize vertices
 *  >1km apart — 青函), but the TOTAL bridged distance per run is capped so bridging never spans
 *  kilometers of genuinely unshared track (red-team) beyond one bounded divergence. */
export const RUN_GAP_HOP_M = 2500;
export const RUN_GAP_TOTAL_M = 6000;
/** Taper step length target, meters (~3 steps ≈ 240 m per 12A). */
export const TAPER_STEP_M = 80;

/**
 * Compute the braid render plan for a package set. Pure; memoized by `packages` ARRAY IDENTITY
 * (the style.ts segmentIndexCache WeakMap idiom). NOTE: today the map style is built ONCE at
 * mount, so a post-boot package self-heal does not re-run this — that pre-existing gap (and the
 * braid props it now also affects) is tracked in TODOS.md "Map doesn't rebuild after a late
 * package self-heal". Returns an empty Map when nothing overlaps (e.g. the CN-only package set).
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

// ───────────────────────────── internal machinery ─────────────────────────────

type Coord = [number, number];

/** Equirectangular meters between two [lon,lat] — fine at rail scales. */
function metersBetween(a: Coord, b: Coord): number {
  const dx = (a[0] - b[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180)) * 111320;
  const dy = (a[1] - b[1]) * 110540;
  return Math.hypot(dx, dy);
}

// Numeric grid keys (string keys measured ~3× slower over 85k vertices — the T7 benchmark
// flagged the first cut at ~290ms vs the 100ms budget). 2^26 headroom per axis is plenty for
// degree/1e-4 magnitudes; negative cells stay unique via the offset.
const KEY_OFFSET = 1 << 25;
const KEY_STRIDE = 1 << 26;
function fineKey(lon: number, lat: number): number {
  return (Math.round(lon / QUANTIZE_DEG) + KEY_OFFSET) * KEY_STRIDE + (Math.round(lat / QUANTIZE_DEG) + KEY_OFFSET);
}

interface LineInfo {
  line: RailLine;
  segments: RailSegment[];
  bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat (+margin)
}

/** ~50m margin in degrees for the bbox prefilter (8A). */
const BBOX_MARGIN_DEG = 5e-4;

function collectLines(packages: RailGeoPackage[]): Map<string, LineInfo> {
  const byLine = new Map<string, LineInfo>();
  for (const pkg of packages) {
    const lineById = new Map(pkg.lines.map((l) => [l.lineId, l]));
    for (const seg of pkg.segments) {
      let info = byLine.get(seg.lineId);
      if (!info) {
        const line = lineById.get(seg.lineId);
        if (!line) continue; // orphan segment — never braid what we can't rank
        info = { line, segments: [], bbox: [Infinity, Infinity, -Infinity, -Infinity] };
        byLine.set(seg.lineId, info);
      }
      info.segments.push(seg);
      for (const c of seg.geometry.coordinates) {
        if (c[0] < info.bbox[0]) info.bbox[0] = c[0];
        if (c[1] < info.bbox[1]) info.bbox[1] = c[1];
        if (c[0] > info.bbox[2]) info.bbox[2] = c[0];
        if (c[1] > info.bbox[3]) info.bbox[3] = c[1];
      }
    }
  }
  for (const info of byLine.values()) {
    info.bbox[0] -= BBOX_MARGIN_DEG;
    info.bbox[1] -= BBOX_MARGIN_DEG;
    info.bbox[2] += BBOX_MARGIN_DEG;
    info.bbox[3] += BBOX_MARGIN_DEG;
  }
  return byLine;
}

/** Symmetric get-or-create pair insert: a↔b into a Map<id, Set<id>>. */
function addPair(m: Map<string, Set<string>>, a: string, b: string): void {
  (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
  (m.get(b) ?? m.set(b, new Set()).get(b)!).add(a);
}

function bboxOverlap(a: LineInfo, b: LineInfo): boolean {
  return a.bbox[0] <= b.bbox[2] && b.bbox[0] <= a.bbox[2] && a.bbox[1] <= b.bbox[3] && b.bbox[1] <= a.bbox[3];
}

function buildPlan(packages: RailGeoPackage[]): OverlapPlan {
  const plan: OverlapPlan = new Map();
  const byLine = collectLines(packages);
  const lineIds = [...byLine.keys()];

  // 8A prefilter. Bbox alone is far too weak (urban Japan: almost every line bbox-overlaps
  // another; the first cut ran ~290ms on the T7 benchmark). Instead: ONE fine quantized grid over
  // the whole network, then a single forward cell sweep marks (a) which line PAIRS actually
  // co-occupy a fine neighborhood — bbox-checked to prune giant-line noise — and (b) the HOT
  // cells where that happens. The per-vertex walk gates on one hot-cell Set peek, so only true
  // corridor vertices (~1.5% of the network) ever pay the 9-cell fine lookup.
  const bboxPairs = new Map<string, Set<string>>();
  for (let i = 0; i < lineIds.length; i++) {
    for (let j = i + 1; j < lineIds.length; j++) {
      const a = byLine.get(lineIds[i])!;
      const b = byLine.get(lineIds[j])!;
      if (!bboxOverlap(a, b)) continue;
      addPair(bboxPairs, lineIds[i], lineIds[j]);
    }
  }

  // The fine grid: cell → (lineId → representative segmentId), whole network, numeric keys.
  const grid = new Map<number, Map<string, string>>();
  for (const [lineId, info] of byLine) {
    for (const seg of info.segments) {
      for (const c of seg.geometry.coordinates) {
        const key = fineKey(c[0], c[1]);
        let cell = grid.get(key);
        if (!cell) grid.set(key, (cell = new Map()));
        if (!cell.has(lineId)) cell.set(lineId, seg.segmentId);
      }
    }
  }

  // Sweep: mark candidate pairs + hot cells. Each unordered cell pair meets exactly once via the
  // 4 forward directions (right / up / up-right / up-left).
  const candidates = new Map<string, Set<string>>();
  const hotCells = new Set<number>();
  const markPair = (a: string, b: string, k1: number, k2: number): void => {
    if (!bboxPairs.get(a)?.has(b)) return;
    addPair(candidates, a, b);
    hotCells.add(k1);
    hotCells.add(k2);
  };
  for (const [k, cell] of grid) {
    if (cell.size > 1) {
      const lids = [...cell.keys()];
      for (let i = 0; i < lids.length; i++) for (let j = i + 1; j < lids.length; j++) markPair(lids[i], lids[j], k, k);
    }
    for (const dk of [KEY_STRIDE, 1, KEY_STRIDE + 1, KEY_STRIDE - 1]) {
      const other = grid.get(k + dk);
      if (!other) continue;
      if (cell.size === 1 && other.size === 1) {
        // fast path: the overwhelmingly common single-line vs single-line adjacency
        const a = cell.keys().next().value as string;
        const b = other.keys().next().value as string;
        if (a !== b) markPair(a, b, k, k + dk);
      } else {
        for (const a of cell.keys()) for (const b of other.keys()) if (a !== b) markPair(a, b, k, k + dk);
      }
    }
  }

  // EDGE grid — the shipped v0.12.0.0 vertex↔vertex matching shredded real corridors into
  // misaligned fragments: the 青函 pair digitizes the SAME tunnel at different cadences (68 vs
  // 88 vertices), so intermediate vertices sit ON the shared track but >16m from any partner
  // VERTEX — runs fragmented per line at DIFFERENT places, rendering half-braided fat lines
  // (design-review regression). Shared track is a vertex-to-POLYLINE relation: rasterize the
  // EDGES of candidate lines into the fine grid (sampled at ~cell size), but only edges near the
  // hot region (coarse 1.1km gate) so the whole-network cost stays trivial.
  const COARSE = 1e-2; // ≈1.1km gate cells
  const coarseKey = (lon: number, lat: number): number =>
    (Math.round(lon / COARSE) + KEY_OFFSET) * KEY_STRIDE + (Math.round(lat / COARSE) + KEY_OFFSET);
  const hotCoarse = new Set<number>();
  for (const k of hotCells) {
    const cx = Math.floor(k / KEY_STRIDE) - KEY_OFFSET;
    const cy = (k % KEY_STRIDE) - KEY_OFFSET;
    const lon = cx * QUANTIZE_DEG;
    const lat = cy * QUANTIZE_DEG;
    for (const dx of [-COARSE, 0, COARSE]) {
      for (const dy of [-COARSE, 0, COARSE]) hotCoarse.add(coarseKey(lon + dx, lat + dy));
    }
  }
  const edgeGrid = new Map<number, Map<string, string>>();
  const stamp = (lon: number, lat: number, lid: string, segId: string): void => {
    const key = fineKey(lon, lat);
    let cell = edgeGrid.get(key);
    if (!cell) edgeGrid.set(key, (cell = new Map()));
    if (!cell.has(lid)) cell.set(lid, segId);
  };
  for (const [lineId, info] of byLine) {
    if (!candidates.has(lineId)) continue;
    for (const seg of info.segments) {
      const cs = seg.geometry.coordinates;
      for (let i = 0; i < cs.length - 1; i++) {
        const [ax, ay] = cs[i];
        const [bx, by] = cs[i + 1];
        if (!hotCoarse.has(coarseKey(ax, ay)) && !hotCoarse.has(coarseKey(bx, by))) continue;
        const n = Math.min(10000, Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) / (QUANTIZE_DEG * 2))));
        for (let t = 0; t <= n; t++) stamp(ax + ((bx - ax) * t) / n, ay + ((by - ay) * t) / n, lineId, seg.segmentId);
      }
    }
  }

  /** Partner lines (≠ self, surviving candidates) whose POLYLINE passes within the 3×3 fine
   *  neighborhood of a vertex — vertex→edge, cadence-proof. Gated by one hot-cell peek at the
   *  coarse tier (the fine hot set no longer covers edge-only cells). */
  function partnersAt(c: number[], self: string, eligible: Set<string>): Map<string, string> {
    const out = new Map<string, string>();
    if (!hotCoarse.has(coarseKey(c[0], c[1]))) return out;
    const base = fineKey(c[0], c[1]);
    for (const dx of [-KEY_STRIDE, 0, KEY_STRIDE]) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = edgeGrid.get(base + dx + dy);
        if (!cell) continue;
        for (const [lid, segId] of cell) {
          if (lid !== self && eligible.has(lid) && !out.has(lid)) out.set(lid, segId);
        }
      }
    }
    return out;
  }

  for (const [lineId, info] of byLine) {
    const eligible = candidates.get(lineId);
    if (!eligible) continue;
    for (const seg of info.segments) {
      const coords = seg.geometry.coordinates as Coord[];
      if (coords.length < MIN_RUN_VERTICES) continue;

      // Per-vertex partner sets (as a stable joined key).
      const vertexPartners: string[][] = [];
      let anyShared = false;
      for (const c of coords) {
        const sorted = [...partnersAt(c, lineId, eligible).keys()].sort();
        vertexPartners.push(sorted);
        if (sorted.length > 0) anyShared = true;
      }
      if (!anyShared) continue;

      // Maximal runs of a CONSTANT non-empty partner set, bridging ≤RUN_GAP_TOLERANCE mismatched
      // vertices (mismatched vertex cadence between the two polylines — Codex #6).
      const runs: { a: number; b: number; partners: string[]; reps: Map<string, string> }[] = [];
      const firstMatch = vertexPartners.findIndex((v) => v.length > 0);
      let lastMatch = vertexPartners.length - 1;
      while (lastMatch > 0 && vertexPartners[lastMatch].length === 0) lastMatch--;
      let i = 0;
      while (i < coords.length) {
        if (vertexPartners[i].length === 0) {
          i++;
          continue;
        }
        const setKey = vertexPartners[i].join('|');
        let end = i;
        let gap = 0;
        let bridged = 0;
        for (let j = i + 1; j < coords.length; j++) {
          if (vertexPartners[j].join('|') === setKey) {
            end = j;
            gap = 0;
            bridged = 0;
          } else {
            const hop = metersBetween(coords[j - 1], coords[j]);
            if (gap < RUN_GAP_TOLERANCE && hop <= RUN_GAP_HOP_M && bridged + hop <= RUN_GAP_TOTAL_M) {
              gap++;
              bridged += hop;
            } else {
              break;
            }
          }
        }
        if (end - i + 1 >= MIN_RUN_VERTICES) {
          // Representative partner segIds resolved at the run's MIDDLE vertex: an INTERIOR vertex
          // belongs to exactly one partner segment, whereas the run's start often sits on a
          // station boundary where two adjacent partner segments share the cell and first-seen
          // could name the neighbor (adversarial review: 326 such cells in jp-2025). The middle
          // can be a gap-BRIDGED vertex with no partner match — fall back to the start (always a
          // matched vertex) rather than demote the run to plain (second adversarial pass).
          const midReps = partnersAt(coords[(i + end) >> 1], lineId, eligible);
          const reps = midReps.has(vertexPartners[i][0]) ? midReps : partnersAt(coords[i], lineId, eligible);
          runs.push({ a: i, b: end, partners: vertexPartners[i], reps });
        }
        i = end + 1;
      }
      if (runs.length === 0) continue;

      // 2A parity — ONE verdict per segment's whole matched extent (not per run): per-run
      // verdicts flip when a curve changes the dominant axis between fragments, drawing an
      // X-cross mid-corridor (design-review regression). Both partners' extents span the same
      // corridor stretch, so their dominant-axis verdicts agree; each line's own traversal
      // order then yields the side-separating parity.
      const forward = canonicalForward(coords[firstMatch], coords[lastMatch]);
      const pieces = splitSegment(coords, runs, info.line, byLine, forward);
      if (pieces) plan.set(seg.segmentId, pieces);
    }
  }
  return plan;
}

/**
 * DD1 slot for `self` within a corridor: members sorted by (rank asc, lineId) — the trunk line
 * first — mapped to symmetric centered values (n=2 → [+0.5, −0.5]; n=3 → [+1, 0, −1]). The trunk
 * always takes the positive side, which parity normalization makes the SAME geographic side of
 * every corridor nationwide.
 */
function slotFor(self: RailLine, partners: RailLine[]): number {
  const members = [self, ...partners].sort((x, y) => {
    const rx = x.rank ?? 99;
    const ry = y.rank ?? 99;
    return rx !== ry ? rx - ry : x.lineId < y.lineId ? -1 : 1;
  });
  const n = members.length;
  const idx = members.findIndex((m) => m.lineId === self.lineId);
  return (n - 1) / 2 - idx;
}

/**
 * 2A canonical-run orientation, jitter-proof: compare the run's QUANTIZED endpoint cells on the
 * run's DOMINANT axis. Raw lon-first lex comparison could disagree between the two partners on a
 * near-north-south corridor whose endpoint lons differ by sub-cell digitization jitter — both
 * strands would then take the SAME side and render coincident (red-team, synthetic repro; the
 * shipped package is clean, 52/52 pairs opposite-side). Quantizing kills sub-cell jitter; the
 * dominant axis makes N-S corridors orient by latitude. Returns null for a degenerate ring
 * (endpoints in the same cell) — the caller renders that run unbraided rather than guess.
 */
function canonicalForward(a: Coord, b: Coord): boolean | null {
  const dLon = Math.round(b[0] / QUANTIZE_DEG) - Math.round(a[0] / QUANTIZE_DEG);
  const dLat = Math.round(b[1] / QUANTIZE_DEG) - Math.round(a[1] / QUANTIZE_DEG);
  if (dLon === 0 && dLat === 0) return null;
  return Math.abs(dLat) > Math.abs(dLon) ? dLat > 0 : dLon > 0;
}

function splitSegment(
  coords: Coord[],
  runs: { a: number; b: number; partners: string[]; reps: Map<string, string> }[],
  selfLine: RailLine,
  byLine: Map<string, LineInfo>,
  forward: boolean | null,
): OverlapPiece[] | null {
  const pieces: OverlapPiece[] = [];
  let cursor = 0;

  const pushPlain = (from: number, to: number): void => {
    if (to <= from) return;
    pieces.push({
      coords: coords.slice(from, to + 1),
      slot: 0,
      partnersMinz: 0,
      partnerSeg: '',
      partnerSeg2: '',
      glowShare: 1,
    });
  };

  for (const run of runs) {
    const partnerLines = run.partners.map((lid) => byLine.get(lid)?.line).filter((l): l is RailLine => !!l);
    if (partnerLines.length === 0) continue;

    // 2A parity from the segment-level canonical verdict (computed once over the full matched
    // extent). line-offset renders right-of-travel, so slot × parity puts every member of the
    // corridor on its consistent geographic side regardless of each line's traversal direction
    // (青函 verified opposite, 成田 verified same — both separate under this rule).
    if (forward === null) {
      // degenerate ring extent — orientation undecidable; render unbraided rather than risk a
      // same-side collision (fail-safe, DD3 spirit).
      pushPlain(cursor, run.b);
      cursor = run.b;
      continue;
    }
    const parity = forward ? 1 : -1;
    const slot = slotFor(selfLine, partnerLines) * parity;
    const partnersMinz = Math.max(...partnerLines.map((l) => minzForRank(l.rank)));
    const partnerSeg = run.reps.get(run.partners[0]) ?? '';
    const partnerSeg2 = run.partners.length > 1 ? (run.reps.get(run.partners[1]) ?? '') : '';
    const glowShare = 1 / (partnerLines.length + 1);

    pushPlain(cursor, run.a); // pre-run remainder (shares the boundary vertex with the run)

    // 12A stepped taper: the offset ramps ⅓ → ⅔ → full over two ~TAPER_STEP_M cuts at each
    // INTERIOR run boundary (a boundary at the segment endpoint = the corridor continues in the
    // adjacent segment, or the mouth sits at a station — no taper there, per 3B). Cut points snap
    // to existing vertices; a run too short for both ladders keeps a plain jump (rare, tiny).
    const runPiece = (from: number, to: number, s: number): void => {
      if (to <= from) return;
      pieces.push({ coords: coords.slice(from, to + 1), slot: s, partnersMinz, partnerSeg, partnerSeg2, glowShare });
    };
    /** Two cut indices ~TAPER_STEP_M apart walking inward from a run boundary; [] if no room. */
    const taperCuts = (boundary: number, inward: 1 | -1, limit: number): number[] => {
      const cuts: number[] = [];
      let acc = 0;
      let idx = boundary;
      while (cuts.length < 2) {
        const next = idx + inward;
        if (inward === 1 ? next >= limit : next <= limit) break;
        acc += metersBetween(coords[idx], coords[next]);
        idx = next;
        if (acc >= TAPER_STEP_M) {
          cuts.push(idx);
          acc = 0;
        }
      }
      return cuts.length === 2 ? cuts : [];
    };

    const taperIn = run.a > 0 ? taperCuts(run.a, 1, run.b) : []; // ascending [c1, c2]
    const taperOut = run.b < coords.length - 1 ? taperCuts(run.b, -1, run.a) : []; // descending [d1, d2]
    // The ladders must not cross (short run) — drop both rather than emit tangled pieces.
    const crossed =
      (taperIn.length > 0 || taperOut.length > 0) &&
      (taperIn[1] ?? run.a) >= (taperOut[1] ?? run.b);
    const cIn = crossed ? [] : taperIn;
    const cOut = crossed ? [] : taperOut;

    let p = run.a;
    if (cIn.length === 2) {
      runPiece(p, cIn[0], slot / 3);
      runPiece(cIn[0], cIn[1], (2 * slot) / 3);
      p = cIn[1];
    }
    const coreEnd = cOut.length === 2 ? cOut[1] : run.b; // cOut = [d1, d2], d2 < d1 (descending walk)
    runPiece(p, coreEnd, slot);
    if (cOut.length === 2) {
      runPiece(cOut[1], cOut[0], (2 * slot) / 3);
      runPiece(cOut[0], run.b, slot / 3);
    }

    cursor = run.b;
  }
  pushPlain(cursor, coords.length - 1); // post-run remainder

  // SEAM INVARIANT (cheap self-check, not a substitute for the tests): pieces must re-concatenate
  // to the original coords. On violation, fail SAFE — no braid for this segment (DD3 spirit).
  let total = 0;
  for (const p of pieces) total += p.coords.length;
  const expected = coords.length + (pieces.length - 1); // each seam shares one vertex
  if (total !== expected) return null;

  return pieces;
}
