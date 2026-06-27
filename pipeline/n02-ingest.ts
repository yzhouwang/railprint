// N02 → RailGeoPackage adapter.
//
// Source: MLIT 国土数値情報（鉄道データ N02）2025, as the GeoJSON extracted in
// Sager1145/Japan-Train-Map (CC BY 4.0; attribution carried below). Turns the raw
// RailroadSection + Station GeoJSON into the engine's RailGeoPackage contract:
//   - group by (operator N02_004 + line name N02_003) — names are NOT unique
//     (JR East 山手線 ≠ 神戸市 山手線), so the operator is part of the key.
//   - build a graph of section endpoints (real N02 has parallel up/down tracks, so
//     simple endpoint-chaining fails; we use Dijkstra over the section graph).
//   - snap each station (display_point, id = N02_005g) to the nearest graph node,
//     order stations along the line, and slice inter-station SEGMENTS (geometry + km)
//     as the shortest path between consecutive stations.
//   - isHSR = N02_002 === '1' (JR Shinkansen). Loops (山手線, 大阪環状線) detected
//     when the station chain closes.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  Country,
  RailGeoPackage,
  RailLine,
  RailSegment,
  RailStation,
} from '../src/contract/types.ts';
import type { LineString, Position } from './geojson.ts';
import { n02LineReadingKey } from './build-readings.ts';
import type { StationReading } from './build-readings.ts';
import {
  haversineKm,
  lineLengthKm,
  projectPointOnLine,
  sliceLineByDistance,
  sliceLoopLineByDistance,
} from './geometry.ts';
import { fallbackLineStyle } from './line-style.ts';
import type { LineStyle } from './line-style.ts';
import { assignRailLineRank } from './line-rank.ts';
import type { RailLineRank } from './line-rank.ts';

export const N02_ATTRIBUTION =
  '出典「国土数値情報（鉄道データ N02）2025年度版」（国土交通省）を加工して作成';

interface N02Feature {
  properties: Record<string, string | number | number[] | undefined>;
  geometry: { type: string; coordinates: Position[] };
}
interface N02FC {
  features: N02Feature[];
}

interface OperatorOverride {
  operatorId: string;
  canonicalName: string;
  aliases: string[];
}

interface OperatorFreeze {
  schemaVersion: number;
  unknownOperatorPolicy: 'raw';
  operators: Record<string, OperatorOverride>;
}

interface OperatorResolution {
  operatorId: string;
  canonicalName: string;
}

export interface RawLine {
  rawOperator: string;
  operator: string;
  operatorId: string;
  name: string;
  n02_002: string;
  sections: Position[][];
  stations: { id: string; name: string; lon: number; lat: number }[];
}

const lineKey = (op: string, name: string): string => `${op}\u0000${name}`;
// Stable, readable line id. MUST be colon-free: the app derives lineId from a segmentId
// via `segmentId.split(':')[0]` (export.ts), and segmentId is `${lineId}:${from}-${to}`.
// Collisions get a deterministic hash suffix in buildPackageFromN02. Exported so build-jp's
// sanity checks resolve lines by the SAME scheme (no drift between two slug implementations).
export function lineId(op: string, name: string): string {
  return `jp-${resolveOperator(op).operatorId}-${name}`.replace(/[\s:]+/g, '');
}

export function legacyLineId(rawOperator: string, name: string): string {
  return `jp-${rawOperator}-${name}`.replace(/[\s:]+/g, '');
}

export function legacyPositionalSegmentId(lineId: string, fromSeq: number, toSeq: number): string {
  return `${lineId}:${fromSeq}-${toSeq}`;
}

function parseOperatorFreeze(): Map<string, OperatorResolution> {
  const raw = JSON.parse(readFileSync(new URL('./overrides/operators.json', import.meta.url), 'utf8')) as Partial<OperatorFreeze>;
  if (raw.schemaVersion !== 1) throw new Error(`unsupported operator freeze schemaVersion: ${String(raw.schemaVersion)}`);
  if (raw.unknownOperatorPolicy !== 'raw') throw new Error(`unsupported unknownOperatorPolicy: ${String(raw.unknownOperatorPolicy)}`);
  const byAlias = new Map<string, OperatorResolution>();
  const register = (alias: string, resolved: OperatorResolution): void => {
    if (!alias) return;
    const existing = byAlias.get(alias);
    if (existing && (existing.operatorId !== resolved.operatorId || existing.canonicalName !== resolved.canonicalName)) {
      throw new Error(`operator alias ${alias} maps to both ${existing.operatorId} and ${resolved.operatorId}`);
    }
    byAlias.set(alias, resolved);
  };
  for (const [rawOperator, entry] of Object.entries(raw.operators ?? {})) {
    if (!entry || typeof entry !== 'object') throw new Error(`invalid operator override for ${rawOperator}`);
    const operatorId = String(entry.operatorId ?? '').trim();
    const canonicalName = String(entry.canonicalName ?? '').trim();
    if (!operatorId || !canonicalName) throw new Error(`operator override ${rawOperator} needs operatorId and canonicalName`);
    const aliases = Array.isArray(entry.aliases) ? entry.aliases.map((v) => String(v).trim()).filter(Boolean) : [];
    const resolved = { operatorId, canonicalName };
    register(rawOperator, resolved);
    register(operatorId, resolved);
    register(canonicalName, resolved);
    for (const alias of aliases) register(alias, resolved);
  }
  return byAlias;
}

const OPERATOR_FREEZE = parseOperatorFreeze();

export function resolveOperator(rawOperator: string): OperatorResolution {
  const raw = rawOperator.trim();
  return OPERATOR_FREEZE.get(raw) ?? { operatorId: raw, canonicalName: raw };
}

export function groupN02(railSections: N02FC, stations: N02FC): RawLine[] {
  const lines = new Map<string, RawLine>();
  const get = (op: string, name: string, n02_002: string): RawLine => {
    const resolved = resolveOperator(op);
    const k = lineKey(resolved.operatorId, name);
    let l = lines.get(k);
    if (!l) {
      l = { rawOperator: op, operator: resolved.canonicalName, operatorId: resolved.operatorId, name, n02_002, sections: [], stations: [] };
      lines.set(k, l);
    }
    return l;
  };
  for (const f of railSections.features) {
    const p = f.properties;
    const op = String(p.N02_004 ?? '');
    const name = String(p.N02_003 ?? '');
    if (!op || !name || f.geometry?.type !== 'LineString') continue;
    get(op, name, String(p.N02_002 ?? '')).sections.push(f.geometry.coordinates);
  }
  for (const f of stations.features) {
    const p = f.properties;
    const op = String(p.N02_004 ?? '');
    const name = String(p.N02_003 ?? '');
    const dp = p.display_point as number[] | undefined;
    if (!op || !name || !Array.isArray(dp)) continue;
    const l = lines.get(lineKey(resolveOperator(op).operatorId, name));
    if (!l) continue; // station for a line with no sections — skip
    l.stations.push({ id: String(p.N02_005g ?? p.N02_005c ?? ''), name: String(p.N02_005 ?? ''), lon: dp[0], lat: dp[1] });
  }
  return [...lines.values()];
}

// ───────────────────────────── per-line graph ──────────────────────────────

const CLUSTER_TOL_KM = 0.012; // ~12m: merge junction endpoints digitized a few metres apart
const GRID_DEG = 0.00015; // ~16m spatial-hash cell (> tol, so a near node is in a neighbour cell)
const cellKey = (cx: number, cy: number): string => `${cx},${cy}`;

interface Edge { to: number; km: number; geom: Position[]; rev: boolean; eid: number }

interface LineGraph {
  coordOf: Position[]; // node index -> coordinate
  adj: Edge[][]; // node -> edges
}

function buildGraph(sections: Position[][]): LineGraph {
  const coordOf: Position[] = [];
  const grid = new Map<string, number[]>(); // cell -> node indices (near-miss clustering)
  // Snap an endpoint to an existing node within CLUSTER_TOL_KM, else create one. This fixes
  // junctions where two N02 sections meet but were digitized a few metres apart (exact-key
  // clustering would split them into separate graph components).
  const nodeOf = (c: Position): number => {
    const cx = Math.round(c[0] / GRID_DEG);
    const cy = Math.round(c[1] / GRID_DEG);
    let best = -1;
    let bestKm = CLUSTER_TOL_KM;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const arr = grid.get(cellKey(cx + dx, cy + dy));
        if (!arr) continue;
        for (const ni of arr) { const d = haversineKm(coordOf[ni], c); if (d <= bestKm) { bestKm = d; best = ni; } }
      }
    }
    if (best !== -1) return best;
    const i = coordOf.length;
    coordOf.push(c);
    const key = cellKey(cx, cy);
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
    return i;
  };
  const adj: Edge[][] = [];
  const ensure = (i: number): void => { while (adj.length <= i) adj.push([]); };
  let eid = 0;
  for (const sec of sections) {
    if (sec.length < 2) continue;
    const a = nodeOf(sec[0]);
    const b = nodeOf(sec[sec.length - 1]);
    if (a === b) continue; // a section that loops back on itself — skip as a graph edge
    const km = lineLengthKm(sec);
    ensure(a); ensure(b);
    adj[a].push({ to: b, km, geom: sec, rev: false, eid });
    adj[b].push({ to: a, km, geom: sec, rev: true, eid });
    eid += 1;
  }
  ensure(coordOf.length - 1);
  return { coordOf, adj };
}

interface DijkstraResult { dist: number[]; prevNode: number[]; prevEdge: (Edge | null)[] }

// Dijkstra from `src`, optionally skipping edges whose eid is in `blocked`.
function dijkstra(g: LineGraph, src: number, blocked?: Set<number>): DijkstraResult {
  const n = g.coordOf.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prevNode = new Array<number>(n).fill(-1);
  const prevEdge = new Array<Edge | null>(n).fill(null);
  const visited = new Array<boolean>(n).fill(false);
  dist[src] = 0;
  for (let it = 0; it < n; it += 1) {
    let u = -1; let best = Infinity;
    for (let i = 0; i < n; i += 1) if (!visited[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u === -1) break;
    visited[u] = true;
    for (const e of g.adj[u]) {
      if (blocked?.has(e.eid)) continue;
      const nd = dist[u] + e.km;
      if (nd < dist[e.to]) { dist[e.to] = nd; prevNode[e.to] = u; prevEdge[e.to] = e; }
    }
  }
  return { dist, prevNode, prevEdge };
}

// Ordered edges along the shortest path from->to (reconstructed from a DijkstraResult).
function pathEdges(res: DijkstraResult, from: number, to: number): Edge[] | null {
  if (from === to) return [];
  const edges: Edge[] = [];
  let cur = to;
  while (cur !== from) {
    const e = res.prevEdge[cur];
    if (!e) return null;
    edges.push(e);
    cur = res.prevNode[cur];
  }
  edges.reverse();
  return edges;
}

// Concatenate edge geometries into one oriented polyline (from->to), de-duping seams.
function edgesToCoords(edges: Edge[]): Position[] {
  const coords: Position[] = [];
  for (const e of edges) {
    const seg = e.rev ? [...e.geom].reverse() : e.geom;
    for (const c of seg) {
      const last = coords[coords.length - 1];
      if (!last || last[0] !== c[0] || last[1] !== c[1]) coords.push(c);
    }
  }
  return coords;
}

// All connected components (node-index lists), sorted by total track km descending — the
// main line first, then progressively smaller disconnected pieces (which T4 may bridge).
function allComponents(g: LineGraph): number[][] {
  const seen = new Array<boolean>(g.coordOf.length).fill(false);
  const out: { comp: number[]; km: number }[] = [];
  for (let s = 0; s < g.coordOf.length; s += 1) {
    if (seen[s] || g.adj[s].length === 0) continue;
    const comp: number[] = [];
    const stack = [s];
    seen[s] = true;
    let km = 0;
    while (stack.length) {
      const u = stack.pop() as number;
      comp.push(u);
      for (const e of g.adj[u]) { km += e.km; if (!seen[e.to]) { seen[e.to] = true; stack.push(e.to); } }
    }
    out.push({ comp, km });
  }
  out.sort((a, b) => b.km - a.km);
  return out.map((o) => o.comp);
}

// The 2-sweep graph-diameter spine of ONE component, as an oriented polyline (or null).
// Also returns the diameter endpoints + sweep result so the caller can run the loop test.
function componentSpine(g: LineGraph, comp: number[]): { coords: Position[]; a: number; b: number; sweep: DijkstraResult } | null {
  const farthest = (src: number): { node: number; res: DijkstraResult } => {
    const res = dijkstra(g, src);
    let node = src;
    let best = -1;
    for (const n of comp) { const d = res.dist[n]; if (d < Infinity && d > best) { best = d; node = n; } }
    return { node, res };
  };
  const a = farthest(comp[0]).node;
  const sweep = farthest(a);
  const b = sweep.node;
  const edges = pathEdges(sweep.res, a, b);
  if (!edges || edges.length === 0) return null;
  const coords = edgesToCoords(edges);
  return coords.length >= 2 ? { coords, a, b, sweep: sweep.res } : null;
}

// Chain disconnected component-spines onto a seed spine, bridging gaps up to `capKm` with a
// straight connector. Bridges are inserted at the PATH level only — never as graph edges —
// so the spine/Dijkstra never route coverage through synthetic track (codex #6). Components
// reachable only across a gap > capKm are dropped (genuinely-abolished sections stay broken).
// Returns the merged polyline + the arc-length intervals that are synthetic (for the gate).
function chainBridges(
  seed: Position[],
  extras: Position[][],
  capKm: number,
): { coords: Position[]; synthetic: [number, number][] } {
  const deque: Position[][] = [seed];
  const remaining = [...extras];
  while (remaining.length) {
    const head = deque[0][0];
    const tailPiece = deque[deque.length - 1];
    const tail = tailPiece[tailPiece.length - 1];
    let best: { i: number; gap: number; end: 'head' | 'tail'; flip: boolean } | null = null;
    for (let i = 0; i < remaining.length; i += 1) {
      const e = remaining[i];
      const e0 = e[0];
      const e1 = e[e.length - 1];
      const cands: { gap: number; end: 'head' | 'tail'; flip: boolean }[] = [
        { gap: haversineKm(tail, e0), end: 'tail', flip: false },
        { gap: haversineKm(tail, e1), end: 'tail', flip: true },
        { gap: haversineKm(head, e1), end: 'head', flip: false },
        { gap: haversineKm(head, e0), end: 'head', flip: true },
      ];
      for (const c of cands) if (!best || c.gap < best.gap) best = { i, ...c };
    }
    if (!best || best.gap > capKm) break;
    const e = remaining.splice(best.i, 1)[0];
    const piece = best.flip ? [...e].reverse() : e;
    if (best.end === 'tail') deque.push(piece); else deque.unshift(piece);
  }
  // Flatten left→right; consecutive pieces always join end→start (oriented above). Each join
  // is a straight connector edge whose arc-interval we record as synthetic.
  const coords: Position[] = [];
  const synthetic: [number, number][] = [];
  let cum = 0;
  for (let k = 0; k < deque.length; k += 1) {
    const piece = deque[k];
    if (k === 0) {
      for (const c of piece) { if (coords.length) cum += haversineKm(coords[coords.length - 1], c); coords.push(c); }
      continue;
    }
    const prev = coords[coords.length - 1];
    const gapKm = haversineKm(prev, piece[0]);
    synthetic.push([cum, cum + gapKm]);
    coords.push(piece[0]); // connector edge prev -> piece[0]
    cum += gapKm;
    for (let j = 1; j < piece.length; j += 1) { cum += haversineKm(coords[coords.length - 1], piece[j]); coords.push(piece[j]); }
  }
  return { coords, synthetic };
}

// Projection candidates: for each maximal run of path segments within `maxSnap` of `point`,
// the closest (along, dist). A line that passes near itself yields MULTIPLE candidates, which
// monotonic assignment uses to avoid collapsing two far-apart stations onto one spot.
function candidateProjections(coords: Position[], cum: number[], point: Position, maxSnap: number): { along: number; dist: number }[] {
  const cands: { along: number; dist: number }[] = [];
  let run: { along: number; dist: number } | null = null;
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1];
    const b = coords[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2));
    const proj: Position = [a[0] + t * dx, a[1] + t * dy];
    const dist = haversineKm(point, proj);
    if (dist <= maxSnap) {
      const along = cum[i - 1] + haversineKm(a, proj);
      if (!run || dist < run.dist) run = { along, dist };
    } else if (run) { cands.push(run); run = null; }
  }
  if (run) cands.push(run);
  return cands;
}

// Equirectangular signed area (km², lon=x lat=y so +ve = CCW) and abs of a closed ring.
function ringArea(ring: Position[]): { area: number; signed: number } {
  if (ring.length < 4) return { area: 0, signed: 0 };
  let lat0 = 0;
  for (const c of ring) lat0 += c[1];
  lat0 /= ring.length;
  const R = 6371.0088;
  const d2r = Math.PI / 180;
  const k = Math.cos(lat0 * d2r);
  let s = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const x1 = ring[i][0] * d2r * R * k;
    const y1 = ring[i][1] * d2r * R;
    const x2 = ring[i + 1][0] * d2r * R * k;
    const y2 = ring[i + 1][1] * d2r * R;
    s += x1 * y2 - x2 * y1;
  }
  return { area: Math.abs(s / 2), signed: s / 2 };
}

const MAX_SNAP_KM = 2; // a station further than this from the spine is treated as off-line noise
const MIN_SPACING_KM = 0.05; // collapse stations that project to ~the same point (dup platforms)
const LOOP_ISO_RATIO = 0.04; // area/circ²: a circle is ~0.0796, a thin double-track sliver ≈ 0
const BRIDGE_CAP_KM = 3.5; // bridge a disconnected component only across gaps ≤ this (data gaps,
//                            NOT abolished sections like 信越線's 横川-篠ノ井 ~65km)
const UNDER_LEN_MIN_KM = 0.3; // only repair under-length slices when the chord is meaningfully long
const UNDER_LEN_RATIO = 0.6; // slice km below chord×this ⇒ the slice collapsed (branch/lollipop)

interface ReadingOptions {
  stationReadings?: Record<string, StationReading>;
  lineReadings?: Record<string, string>;
  lineStyles?: Record<string, LineStyle>;
}

interface BuiltLine {
  line: RailLine;
  segments: RailSegment[];
  stations: RailStation[];
  bridgedKm: number;
  identity: { operatorId: string; name: string; minGroupCode: string };
  legacyLineId: string;
  usedSegmentGroupTiebreaker: boolean;
}

export interface SegmentIdMigrationDraft {
  lineIdMap: Record<string, string>;
  segmentIdMap: Record<string, string>;
  unmapped: string[];
}

// Total length of the synthetic (bridge) intervals overlapping [fromKm, toKm].
function syntheticOverlapKm(synthetic: [number, number][], fromKm: number, toKm: number): number {
  const lo = Math.min(fromKm, toKm);
  const hi = Math.max(fromKm, toKm);
  let km = 0;
  for (const [a, b] of synthetic) km += Math.max(0, Math.min(hi, b) - Math.max(lo, a));
  return km;
}

function segmentGroupTokens(ordered: { id: string }[]): { tokens: string[]; usedTiebreaker: boolean } {
  const totals = new Map<string, number>();
  for (const station of ordered) totals.set(station.id, (totals.get(station.id) ?? 0) + 1);
  const seen = new Map<string, number>();
  let usedTiebreaker = false;
  const tokens = ordered.map((station) => {
    const occurrence = seen.get(station.id) ?? 0;
    seen.set(station.id, occurrence + 1);
    if ((totals.get(station.id) ?? 0) <= 1) return station.id;
    usedTiebreaker = true;
    return `${station.id}@${occurrence}`;
  });
  return { tokens, usedTiebreaker };
}

function assertUniqueSegmentIds(lineIdForMessage: string, segments: RailSegment[]): void {
  const seen = new Set<string>();
  for (const segment of segments) {
    if (seen.has(segment.segmentId)) throw new Error(`segmentId collision on ${lineIdForMessage}: ${segment.segmentId}`);
    seen.add(segment.segmentId);
  }
}

function buildLine(raw: RawLine, country: Country, readings?: ReadingOptions): BuiltLine | null {
  if (raw.stations.length < 2 || raw.sections.length === 0) return null;
  const g = buildGraph(raw.sections);
  const comps = allComponents(g);
  if (comps.length === 0 || comps[0].length < 2) return null;

  // ── Primary spine = graph diameter of the largest component. On double-track data this
  //    rides ONE track (Dijkstra takes the shorter parallel edge) → length ≈ real line km.
  const primary = componentSpine(g, comps[0]);
  if (!primary) return null;

  // ── Real-loop test on the primary component: is there an alternate A→B path NOT using the
  //    spine? A genuine geographic loop (大阪環状線) encloses real area; a double-track
  //    out-and-back encloses ~none. Tell them apart by isoperimetric ratio area/circ².
  let isLoop = false;
  let arcDirection: 'cw' | 'ccw' | undefined;
  let path: LineString = { type: 'LineString', coordinates: primary.coords };
  let synthetic: [number, number][] = [];
  const blocked = new Set((pathEdges(primary.sweep, primary.a, primary.b) ?? []).map((e) => e.eid));
  const alt = dijkstra(g, primary.a, blocked);
  if (alt.dist[primary.b] < Infinity) {
    const retEdges = pathEdges(alt, primary.a, primary.b);
    if (retEdges && retEdges.length) {
      // ring = spine (a→b) + return reversed (b→a), dropping the duplicate seam vertex b.
      // NOTE: reverse THEN slice — `retCoords.slice(1).reverse()` would drop the closing
      // edge back to `a` and duplicate b at the seam, leaving the ring open by one edge.
      const retCoords = [...edgesToCoords(retEdges)].reverse(); // b → a
      const ring = [...primary.coords, ...retCoords.slice(1)]; // a→b→…→a (closed)
      const circ = lineLengthKm(ring);
      const { area, signed } = ringArea(ring);
      if (raw.stations.length > 3 && circ > 0 && area / (circ * circ) > LOOP_ISO_RATIO) {
        isLoop = true;
        arcDirection = signed > 0 ? 'ccw' : 'cw';
        path = { type: 'LineString', coordinates: ring };
      }
    }
  }

  // ── T4: bridge disconnected components onto the spine (capped). Skip for loops — don't
  //    graft tails onto a closed ring. Bridges join at the PATH level only (never graph
  //    edges), so the diameter/Dijkstra above never routed coverage through synthetic track.
  if (!isLoop && comps.length > 1) {
    const extras = comps.slice(1)
      .map((c) => componentSpine(g, c))
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map((s) => s.coords);
    if (extras.length) {
      const chained = chainBridges(primary.coords, extras, BRIDGE_CAP_KM);
      path = { type: 'LineString', coordinates: chained.coords };
      synthetic = chained.synthetic;
    }
  }

  // ── De-dup stations by group id then by name (handles 新宿×4 / 新大阪×2 platform records).
  const byId = new Set<string>();
  const byName = new Set<string>();
  const uniq = raw.stations
    .filter((s) => s.id && !byId.has(s.id) && (byId.add(s.id), true))
    .filter((s) => s.name && !byName.has(s.name) && (byName.add(s.name), true));

  // ── Order stations along the path by arc-length. For OPEN lines use monotonic
  //    (sequence-aware) projection: a line that passes near itself (大江戸線 loop+tail,
  //    鶴見線 branches) would otherwise project a far station onto the wrong nearby arc and
  //    emit an absurdly short segment. For loops, plain nearest-projection on the ring works.
  const coordsArr = path.coordinates;
  const cum: number[] = [0];
  for (let i = 1; i < coordsArr.length; i += 1) cum.push(cum[i - 1] + haversineKm(coordsArr[i - 1], coordsArr[i]));

  type Placed = { id: string; name: string; lon: number; lat: number; along: number };
  let placed: Placed[];
  if (isLoop) {
    placed = uniq
      .map((s) => ({ s, proj: projectPointOnLine([s.lon, s.lat], path) }))
      .filter((p) => p.proj.distanceKm <= MAX_SNAP_KM)
      .map((p) => ({ id: p.s.id, name: p.s.name, lon: p.s.lon, lat: p.s.lat, along: p.proj.alongKm }))
      .sort((a, b) => a.along - b.along);
  } else {
    const items = uniq
      .map((s) => ({ s, cands: candidateProjections(coordsArr, cum, [s.lon, s.lat], MAX_SNAP_KM) }))
      .filter((it) => it.cands.length > 0);
    const globalAlong = (it: typeof items[number]): number => {
      let m = it.cands[0];
      for (const c of it.cands) if (c.dist < m.dist) m = c;
      return m.along;
    };
    items.sort((a, b) => globalAlong(a) - globalAlong(b));
    let prev = -Infinity;
    placed = [];
    for (const it of items) {
      // Prefer the closest candidate that does NOT go backwards; if none, take the closest
      // (a genuine out-of-order station resets the monotone frontier).
      let pick: { along: number; dist: number } | null = null;
      for (const c of it.cands) if (c.along >= prev - 1e-9 && (!pick || c.dist < pick.dist)) pick = c;
      if (!pick) { pick = it.cands[0]; for (const c of it.cands) if (c.dist < pick.dist) pick = c; }
      placed.push({ id: it.s.id, name: it.s.name, lon: it.s.lon, lat: it.s.lat, along: pick.along });
      prev = Math.max(prev, pick.along);
    }
    placed.sort((a, b) => a.along - b.along);
  }
  // Collapse stations that landed at ~the same arc-position.
  const ordered: Placed[] = [];
  for (const r of placed) {
    const prev = ordered[ordered.length - 1];
    if (prev && r.along - prev.along < MIN_SPACING_KM) continue;
    ordered.push(r);
  }
  if (ordered.length < 2) return null;
  // A "loop" needs ≥3 surviving stations: with 2, the wrap (last→first) and forward
  // segment share the same unordered station pair, and segmentsBetween's pair-map would
  // collapse the two arcs into one. Demote such a degenerate case to an open line.
  if (isLoop && ordered.length < 3) isLoop = false;

  // ── Slice inter-station segments out of the path. stationId is LINE-SCOPED (`${id}:${g}`)
  //    so transfer stations sharing an N02_005g don't collapse in geo.stationById.
  const isHSR = raw.n02_002 === '1';
  const id = lineId(raw.operatorId, raw.name);
  const sid = (groupId: string): string => `${id}:${groupId}`;
  const segments: RailSegment[] = [];
  let bridgedKm = 0;
  const { tokens: groupTokens, usedTiebreaker } = segmentGroupTokens(ordered);
  const pairCount = isLoop ? ordered.length : ordered.length - 1;
  for (let i = 0; i < pairCount; i += 1) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    const wrap = isLoop && i === ordered.length - 1; // closing segment last→first
    const geomLine = wrap || a.along > b.along
      ? sliceLoopLineByDistance(path, a.along, b.along)
      : sliceLineByDistance(path, a.along, b.along);
    let geom: Position[] = geomLine.coordinates.length >= 2
      ? geomLine.coordinates
      : [[a.lon, a.lat], [b.lon, b.lat]] as Position[];
    let km = Math.round(lineLengthKm(geom) * 1000) / 1000;
    // Under-length repair: on a branch/lollipop line the spine may not traverse the arc
    // BETWEEN these two stations, so the slice collapses to ~0 (大江戸線 門前仲町→森下 was
    // 0.061km vs 1.7km real). When the slice is far below the station straight-line distance,
    // the slice is bogus — fall back to the honest station-to-station chord so km is correct.
    const straightKm = haversineKm([a.lon, a.lat], [b.lon, b.lat]);
    if (straightKm > UNDER_LEN_MIN_KM && km < straightKm * UNDER_LEN_RATIO) {
      geom = [[a.lon, a.lat], [b.lon, b.lat]];
      km = Math.round(straightKm * 1000) / 1000;
    }
    if (!isLoop) bridgedKm += syntheticOverlapKm(synthetic, a.along, b.along);
    const seg: RailSegment = {
      segmentId: `${id}:${groupTokens[i]}-${groupTokens[(i + 1) % ordered.length]}`,
      lineId: id,
      fromStationId: sid(a.id),
      toStationId: sid(b.id),
      fromSeq: i,
      toSeq: (i + 1) % ordered.length,
      km,
      isHSR,
      geometry: { type: 'LineString', coordinates: geom },
    };
    if (isLoop && arcDirection) seg.arcDirection = arcDirection;
    segments.push(seg);
  }
  if (segments.length === 0) return null;
  assertUniqueSegmentIds(id, segments);

  const stations: RailStation[] = ordered.map((s, seq) => {
    const reading = readings?.stationReadings?.[s.id];
    return {
      stationId: sid(s.id), name: s.name, lineId: id, seq, lon: s.lon, lat: s.lat, stationGroupId: s.id,
      ...(reading ? { nameRoma: reading.romaji, romaSource: reading.source } : {}),
    };
  });
  const line: RailLine = {
    lineId: id, name: raw.name, country, operator: raw.operator, isHSR, isLoop,
    stationOrder: stations.map((s) => s.stationId),
    geometry: path,
  };
  (line as RailLine & { rank: RailLineRank }).rank = assignRailLineRank({
    operator: raw.operatorId,
    name: raw.name,
    isHSR,
    stationCount: stations.length,
    km: segments.reduce((sum, segment) => sum + segment.km, 0),
  });
  const lineReadingKey = n02LineReadingKey(raw.operator, raw.name);
  const operatorIdLineReadingKey = n02LineReadingKey(raw.operatorId, raw.name);
  const style = readings?.lineStyles?.[lineReadingKey] ?? readings?.lineStyles?.[operatorIdLineReadingKey] ?? fallbackLineStyle({
    operator: raw.operatorId,
    name: raw.name,
    n02_002: raw.n02_002,
  });
  line.color = style.color;
  if (style.logoFile) line.logo = `/rail/logos/${id}.png`;
  const nameRoma = readings?.lineReadings?.[lineReadingKey] ?? readings?.lineReadings?.[operatorIdLineReadingKey];
  if (nameRoma) line.nameRoma = nameRoma;
  const minGroupCode = ordered.reduce((min, station) => (min === '' || station.id < min ? station.id : min), '');
  return {
    line,
    segments,
    stations,
    bridgedKm: Math.round(bridgedKm * 1000) / 1000,
    identity: { operatorId: raw.operatorId, name: raw.name, minGroupCode },
    legacyLineId: legacyLineId(raw.rawOperator, raw.name),
    usedSegmentGroupTiebreaker: usedTiebreaker,
  };
}

// ─────────────────────────── geometry simplification ───────────────────────────
// Rail curves don't need sub-metre precision at map zooms. We round coords to ~1.1m
// and Douglas–Peucker the polylines AFTER km is computed, so displayed geometry shrinks
// without disturbing the (accurate) segment lengths.

function roundCoord(c: number[]): Position {
  return [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5];
}

function perpDistDeg(p: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  const px = a[0] + t * dx;
  const py = a[1] + t * dy;
  return Math.hypot(p[0] - px, p[1] - py);
}

function simplify(coords: number[][], tol: number): Position[] {
  if (coords.length <= 2) return coords.map(roundCoord);
  const keep = new Array<boolean>(coords.length).fill(false);
  keep[0] = true;
  keep[coords.length - 1] = true;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop() as [number, number];
    let idx = -1;
    let max = tol;
    for (let i = lo + 1; i < hi; i += 1) {
      const d = perpDistDeg(coords[i], coords[lo], coords[hi]);
      if (d > max) { max = d; idx = i; }
    }
    if (idx !== -1) { keep[idx] = true; stack.push([lo, idx], [idx, hi]); }
  }
  const out: Position[] = [];
  for (let i = 0; i < coords.length; i += 1) if (keep[i]) out.push(roundCoord(coords[i]));
  return out.length >= 2 ? out : [roundCoord(coords[0]), roundCoord(coords[coords.length - 1])];
}

function simplifyGeometry(line: { coordinates: number[][] }, tol: number): LineString {
  return { type: 'LineString', coordinates: simplify(line.coordinates, tol) };
}

export interface IngestOptions extends ReadingOptions { country: Country; version: string; generatedAt: string; simplifyTolDeg?: number }

function collisionHash(identity: BuiltLine['identity']): string {
  return createHash('sha256')
    .update(`${identity.operatorId}|${identity.name}|${identity.minGroupCode}`)
    .digest('hex')
    .slice(0, 6);
}

function remapBuiltLineId(built: BuiltLine, newId: string): void {
  const oldId = built.line.lineId;
  if (oldId === newId) return;
  const remap = (value: string): string => {
    if (value === oldId) return newId;
    return value.startsWith(`${oldId}:`) ? `${newId}${value.slice(oldId.length)}` : value;
  };
  built.line.lineId = newId;
  built.line.stationOrder = built.line.stationOrder.map(remap);
  if (built.line.logo) built.line.logo = `/rail/logos/${newId}.png`;
  for (const segment of built.segments) {
    segment.lineId = newId;
    segment.segmentId = remap(segment.segmentId);
    segment.fromStationId = remap(segment.fromStationId);
    segment.toStationId = remap(segment.toStationId);
  }
  for (const station of built.stations) {
    station.lineId = newId;
    station.stationId = remap(station.stationId);
  }
  assertUniqueSegmentIds(newId, built.segments);
}

function setMapEntry(map: Record<string, string>, from: string, to: string, label: string): void {
  const existing = map[from];
  if (existing && existing !== to) throw new Error(`${label} collision: ${from} maps to both ${existing} and ${to}`);
  map[from] = to;
}

function buildSegmentIdMigrationDraft(builtLines: BuiltLine[]): SegmentIdMigrationDraft {
  const lineIdMap: Record<string, string> = {};
  const segmentIdMap: Record<string, string> = {};
  for (const built of builtLines) {
    if (built.legacyLineId !== built.line.lineId) {
      setMapEntry(lineIdMap, built.legacyLineId, built.line.lineId, 'legacy lineId');
    }
    for (const segment of built.segments) {
      const oldSegmentId = legacyPositionalSegmentId(built.legacyLineId, segment.fromSeq, segment.toSeq);
      if (oldSegmentId === segment.segmentId) {
        throw new Error(`legacy segmentId did not change: ${oldSegmentId}`);
      }
      setMapEntry(segmentIdMap, oldSegmentId, segment.segmentId, 'legacy segmentId');
    }
  }
  return { lineIdMap, segmentIdMap, unmapped: [] };
}

export function buildPackageFromN02(railSections: N02FC, stations: N02FC, opts: IngestOptions): {
  pkg: RailGeoPackage;
  migrationDraft: SegmentIdMigrationDraft;
  stats: {
    totalLines: number;
    built: number;
    skipped: number;
    loops: number;
    hsrLines: number;
    bridgedLines: number;
    bridgedKm: number;
    hashedLineIds: number;
    segmentTiebreakerLines: number;
  };
} {
  const raws = groupN02(railSections, stations);
  let built = 0; let skipped = 0; let loops = 0; let hsrLines = 0;
  let bridgedLines = 0; let bridgedKm = 0;
  let segmentTiebreakerLines = 0;
  const tol = opts.simplifyTolDeg ?? 0;
  const builtLines: BuiltLine[] = [];
  for (const raw of raws) {
    const b = buildLine(raw, opts.country, opts);
    if (!b) { skipped += 1; continue; }
    builtLines.push(b);
    built += 1; if (b.line.isLoop) loops += 1; if (b.line.isHSR) hsrLines += 1;
    if (b.usedSegmentGroupTiebreaker) segmentTiebreakerLines += 1;
    if (b.bridgedKm > 0) { bridgedLines += 1; bridgedKm += b.bridgedKm; }
  }

  const byBaseId = new Map<string, BuiltLine[]>();
  for (const line of builtLines) (byBaseId.get(line.line.lineId) ?? byBaseId.set(line.line.lineId, []).get(line.line.lineId)!).push(line);
  let hashedLineIds = 0;
  for (const [baseId, members] of byBaseId) {
    if (members.length < 2) continue;
    for (const member of members) {
      remapBuiltLineId(member, `${baseId}~${collisionHash(member.identity)}`);
      hashedLineIds += 1;
    }
  }

  const finalLineIds = new Set<string>();
  for (const line of builtLines) {
    if (finalLineIds.has(line.line.lineId)) throw new Error(`lineId collision after hash suffix: ${line.line.lineId}`);
    finalLineIds.add(line.line.lineId);
  }

  const lines: RailLine[] = [];
  const segments: RailSegment[] = [];
  const stas: RailStation[] = [];
  for (const b of builtLines) {
    // Simplify rendered geometry (km already computed from full-resolution coords).
    if (tol > 0) {
      b.line.geometry = simplifyGeometry(b.line.geometry, tol);
      for (const s of b.segments) s.geometry = simplifyGeometry(s.geometry, tol);
    }
    for (const s of b.stations) { const [lon, lat] = roundCoord([s.lon, s.lat]); s.lon = lon; s.lat = lat; }
    lines.push(b.line); segments.push(...b.segments); stas.push(...b.stations);
  }
  const pkg: RailGeoPackage = {
    version: opts.version, generatedAt: opts.generatedAt, crs: 'WGS84', country: opts.country,
    lines, segments, stations: stas,
  };
  const migrationDraft = buildSegmentIdMigrationDraft(builtLines);
  if (Object.keys(migrationDraft.segmentIdMap).length !== segments.length) {
    throw new Error(`segment migration is not exhaustive: ${Object.keys(migrationDraft.segmentIdMap).length}/${segments.length}`);
  }
  const newSegmentIds = new Set(segments.map((segment) => segment.segmentId));
  for (const newSegmentId of Object.values(migrationDraft.segmentIdMap)) {
    if (!newSegmentIds.has(newSegmentId)) throw new Error(`segment migration points to missing segmentId: ${newSegmentId}`);
  }
  return {
    pkg,
    migrationDraft,
    stats: {
      totalLines: raws.length,
      built,
      skipped,
      loops,
      hsrLines,
      bridgedLines,
      bridgedKm: Math.round(bridgedKm),
      hashedLineIds,
      segmentTiebreakerLines,
    },
  };
}
