import type {
  FindRoutes,
  RailGeoPackage,
  RailLine,
  RailSegment,
  RailStation,
  RouteCandidate,
} from '../contract/types';

export const MAX_ROUTE_STATIONS = 80;
export const MAX_SPURS = 50;

const EPS = 1e-9;
const NUL = '\0';
const SOURCE_NODE = `${NUL}route-source`;
const SINK_NODE = `${NUL}route-sink`;

type EdgeKind = 'segment' | 'switch' | 'source' | 'sink';

interface Cost {
  lineChanges: number;
  km: number;
}

interface RouteEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  lineChanges: number;
  km: number;
  key: string;
  segmentId?: string;
  lineId?: string;
}

interface RouteGraph {
  lineById: Map<string, RailLine>;
  stationById: Map<string, RailStation>;
  segmentById: Map<string, RailSegment>;
  stationsByGroup: Map<string, string[]>;
  segmentByLinePair: Map<string, RailSegment>;
  edges: Map<string, RouteEdge[]>;
}

interface RoutePath {
  nodes: string[];
  edges: RouteEdge[];
  cost: Cost;
  segmentIds: string[];
  lines: string[];
  segmentKey: string;
  pathKey: string;
}

interface QueueState {
  node: string;
  nodes: string[];
  edges: RouteEdge[];
  cost: Cost;
  key: string;
}

interface DijkstraOptions {
  bannedNodes?: Set<string>;
  bannedEdges?: Set<string>;
}

export interface RouteEdgeTestView {
  from: string;
  to: string;
  kind: EdgeKind;
  lineChanges: number;
  km: number;
  segmentId?: string;
  lineId?: string;
}

export interface RouteGraphTestView {
  edges: ReadonlyMap<string, readonly RouteEdgeTestView[]>;
  stationsByGroup: ReadonlyMap<string, readonly string[]>;
}

let routeGraphCache = new WeakMap<RailGeoPackage, RouteGraph>();
let routeGraphBuilds = 0;

const groupKeyOf = (station: RailStation): string => station.stationGroupId ?? `solo:${station.stationId}`;

export const findRoutes: FindRoutes = (pkg, fromGroupKey, toGroupKey, k = 3) => {
  if (fromGroupKey === toGroupKey) return [];

  const graph = routeGraphFor(pkg);
  const fromStations = graph.stationsByGroup.get(fromGroupKey);
  const toStations = graph.stationsByGroup.get(toGroupKey);
  if (!fromStations?.length || !toStations?.length) return [];

  const requested = Math.max(1, Math.floor(k));
  const singleLineRoutes = enumerateSingleLineRoutes(graph, fromGroupKey, toGroupKey, pkg.version);
  const limit = Math.max(requested, singleLineRoutes.length);

  const out: RouteCandidate[] = [];
  const seenSegmentSets = new Set<string>();
  const addCandidate = (candidate: RouteCandidate): void => {
    if (candidate.segmentIds.length === 0) return;
    const key = canonicalSegmentKey(candidate.segmentIds);
    if (seenSegmentSets.has(key)) return;
    seenSegmentSets.add(key);
    out.push(candidate);
  };

  for (const candidate of singleLineRoutes) addCandidate(candidate);

  const yenPaths = kShortestPaths(graph, fromStations, toStations, limit);
  for (const path of yenPaths) {
    const candidate = candidateFromPath(path, pkg.version);
    if (candidate) addCandidate(candidate);
    if (out.length >= limit) break;
  }

  return out.sort(compareCandidates).slice(0, limit);
};

export const __routeTest = {
  resetGraphCache(): void {
    routeGraphCache = new WeakMap<RailGeoPackage, RouteGraph>();
    routeGraphBuilds = 0;
  },
  graphBuildCount(): number {
    return routeGraphBuilds;
  },
  graphForPackage(pkg: RailGeoPackage): RouteGraphTestView {
    return routeGraphFor(pkg);
  },
};

function routeGraphFor(pkg: RailGeoPackage): RouteGraph {
  let graph = routeGraphCache.get(pkg);
  if (!graph) {
    graph = buildRouteGraph(pkg);
    routeGraphCache.set(pkg, graph);
  }
  return graph;
}

function buildRouteGraph(pkg: RailGeoPackage): RouteGraph {
  routeGraphBuilds += 1;

  const lineById = new Map(pkg.lines.map((line) => [line.lineId, line]));
  const stationById = new Map<string, RailStation>();
  const segmentById = new Map<string, RailSegment>();
  const stationsByGroup = new Map<string, string[]>();
  const segmentByLinePair = new Map<string, RailSegment>();
  const edges = new Map<string, RouteEdge[]>();

  for (const station of pkg.stations) {
    stationById.set(station.stationId, station);
    edges.set(station.stationId, []);
    const groupKey = groupKeyOf(station);
    (stationsByGroup.get(groupKey) ?? stationsByGroup.set(groupKey, []).get(groupKey)!).push(station.stationId);
  }

  for (const segment of pkg.segments) {
    if (!stationById.has(segment.fromStationId) || !stationById.has(segment.toStationId)) continue;
    segmentById.set(segment.segmentId, segment);
    segmentByLinePair.set(linePairKey(segment.lineId, segment.fromStationId, segment.toStationId), segment);
    addDirectedEdge(edges, segment.fromStationId, segment.toStationId, {
      kind: 'segment',
      lineChanges: 0,
      km: segment.km,
      segmentId: segment.segmentId,
      lineId: segment.lineId,
    });
    addDirectedEdge(edges, segment.toStationId, segment.fromStationId, {
      kind: 'segment',
      lineChanges: 0,
      km: segment.km,
      segmentId: segment.segmentId,
      lineId: segment.lineId,
    });
  }

  for (const stationIds of stationsByGroup.values()) {
    stationIds.sort(compareStationIdsByLine(stationById));
    if (stationIds.length < 2) continue;
    for (let i = 0; i < stationIds.length; i += 1) {
      for (let j = i + 1; j < stationIds.length; j += 1) {
        const a = stationById.get(stationIds[i])!;
        const b = stationById.get(stationIds[j])!;
        if (a.lineId === b.lineId) continue;
        addDirectedEdge(edges, a.stationId, b.stationId, { kind: 'switch', lineChanges: 1, km: 0 });
        addDirectedEdge(edges, b.stationId, a.stationId, { kind: 'switch', lineChanges: 1, km: 0 });
      }
    }
  }

  for (const list of edges.values()) list.sort(compareEdges);
  return { lineById, stationById, segmentById, stationsByGroup, segmentByLinePair, edges };
}

function addDirectedEdge(
  edges: Map<string, RouteEdge[]>,
  from: string,
  to: string,
  edge: Omit<RouteEdge, 'from' | 'to' | 'key'>,
): void {
  edges.get(from)?.push({ ...edge, from, to, key: edgeKey(from, to, edge.kind, edge.segmentId) });
}

function edgeKey(from: string, to: string, kind: EdgeKind, segmentId?: string): string {
  return [from, to, kind, segmentId ?? ''].join(NUL);
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}${NUL}${b}` : `${b}${NUL}${a}`;
}

function linePairKey(lineId: string, a: string, b: string): string {
  return `${lineId}${NUL}${pairKey(a, b)}`;
}

function compareStationIdsByLine(stationById: Map<string, RailStation>): (a: string, b: string) => number {
  return (a, b) => {
    const sa = stationById.get(a);
    const sb = stationById.get(b);
    return (sa?.lineId ?? '').localeCompare(sb?.lineId ?? '') || a.localeCompare(b);
  };
}

function compareEdges(a: RouteEdge, b: RouteEdge): number {
  return a.key.localeCompare(b.key);
}

function enumerateSingleLineRoutes(
  graph: RouteGraph,
  fromGroupKey: string,
  toGroupKey: string,
  railGeoVersion: string,
): RouteCandidate[] {
  const fromStations = graph.stationsByGroup.get(fromGroupKey) ?? [];
  const toStations = graph.stationsByGroup.get(toGroupKey) ?? [];
  const fromByLine = stationsByLine(graph, fromStations);
  const toByLine = stationsByLine(graph, toStations);
  const candidates: RouteCandidate[] = [];
  const seen = new Set<string>();

  for (const lineId of [...fromByLine.keys()].sort()) {
    const line = graph.lineById.get(lineId);
    const toLineStations = toByLine.get(lineId);
    if (!line || !toLineStations?.length) continue;
    for (const fromStationId of fromByLine.get(lineId) ?? []) {
      for (const toStationId of toLineStations) {
        if (fromStationId === toStationId) continue;
        for (const candidate of routesOnLine(graph, line, fromStationId, toStationId, railGeoVersion)) {
          const key = canonicalSegmentKey(candidate.segmentIds);
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push(candidate);
        }
      }
    }
  }

  return candidates.sort(compareCandidates);
}

function stationsByLine(graph: RouteGraph, stationIds: string[]): Map<string, string[]> {
  const byLine = new Map<string, string[]>();
  for (const stationId of stationIds) {
    const station = graph.stationById.get(stationId);
    if (!station) continue;
    (byLine.get(station.lineId) ?? byLine.set(station.lineId, []).get(station.lineId)!).push(stationId);
  }
  for (const ids of byLine.values()) ids.sort();
  return byLine;
}

function routesOnLine(
  graph: RouteGraph,
  line: RailLine,
  fromStationId: string,
  toStationId: string,
  railGeoVersion: string,
): RouteCandidate[] {
  const idxA = line.stationOrder.indexOf(fromStationId);
  const idxB = line.stationOrder.indexOf(toStationId);
  if (idxA === -1 || idxB === -1 || idxA === idxB) return [];

  const walk = (step: 1 | -1): RouteCandidate | null => {
    const segmentIds: string[] = [];
    let totalKm = 0;
    let i = idxA;
    let guard = 0;

    while (i !== idxB) {
      if (guard > line.stationOrder.length) return null;
      guard += 1;
      const j = line.isLoop ? (i + step + line.stationOrder.length) % line.stationOrder.length : i + step;
      if (j < 0 || j >= line.stationOrder.length) return null;
      const segment = graph.segmentByLinePair.get(linePairKey(line.lineId, line.stationOrder[i], line.stationOrder[j]));
      if (!segment) return null;
      segmentIds.push(segment.segmentId);
      totalKm += segment.km;
      i = j;
    }

    if (segmentIds.length === 0) return null;
    return {
      segmentIds,
      lines: [line.lineId],
      totalKm,
      lineChanges: 0,
      railGeoVersion,
    };
  };

  const candidates = line.isLoop ? [walk(1), walk(-1)] : [walk(idxA < idxB ? 1 : -1)];
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    if (!candidate) return [];
    const key = canonicalSegmentKey(candidate.segmentIds);
    if (seen.has(key)) return [];
    seen.add(key);
    return [candidate];
  }).sort(compareCandidates);
}

function kShortestPaths(graph: RouteGraph, fromStations: string[], toStations: string[], limit: number): RoutePath[] {
  const targetSet = new Set(toStations);
  const first = shortestPath(graph, fromStations, targetSet, SOURCE_NODE);
  if (!first) return [];

  const accepted: RoutePath[] = [first];
  const acceptedSegmentKeys = new Set([first.segmentKey]);
  const acceptedPathKeys = new Set([first.pathKey]);
  const candidates = new MinHeap<RoutePath>(comparePaths);
  const queuedPathKeys = new Set<string>();
  let spurCount = 0;
  let stopped = actualStationCount(first) > MAX_ROUTE_STATIONS;

  while (accepted.length < limit && !stopped) {
    const previous = accepted[accepted.length - 1];
    for (let spurIndex = 0; spurIndex < previous.nodes.length - 1; spurIndex += 1) {
      if (spurCount >= MAX_SPURS) {
        stopped = true;
        break;
      }
      spurCount += 1;

      const rootNodes = previous.nodes.slice(0, spurIndex + 1);
      const rootEdges = previous.edges.slice(0, spurIndex);
      const spurNode = previous.nodes[spurIndex];
      const bannedNodes = new Set(rootNodes.slice(0, -1));
      const bannedEdges = new Set<string>();

      for (const path of accepted) {
        if (sameRoot(path.nodes, rootNodes) && path.edges[spurIndex]) bannedEdges.add(path.edges[spurIndex].key);
      }

      const spurPath = shortestPath(graph, fromStations, targetSet, spurNode, { bannedNodes, bannedEdges });
      if (!spurPath) continue;

      const totalPath = makePath(rootNodes.concat(spurPath.nodes.slice(1)), rootEdges.concat(spurPath.edges));
      if (hasRepeatedNodes(totalPath.nodes) || acceptedPathKeys.has(totalPath.pathKey) || queuedPathKeys.has(totalPath.pathKey)) {
        continue;
      }
      if (actualStationCount(totalPath) > MAX_ROUTE_STATIONS) {
        stopped = true;
        break;
      }

      queuedPathKeys.add(totalPath.pathKey);
      candidates.push(totalPath);
    }

    let next: RoutePath | undefined;
    while (candidates.size > 0) {
      const candidate = candidates.pop()!;
      queuedPathKeys.delete(candidate.pathKey);
      if (acceptedSegmentKeys.has(candidate.segmentKey)) continue;
      next = candidate;
      break;
    }
    if (!next) break;

    accepted.push(next);
    acceptedSegmentKeys.add(next.segmentKey);
    acceptedPathKeys.add(next.pathKey);
  }

  return accepted;
}

function shortestPath(
  graph: RouteGraph,
  fromStations: string[],
  targetSet: Set<string>,
  startNode: string,
  options: DijkstraOptions = {},
): RoutePath | null {
  const heap = new MinHeap<QueueState>(compareQueueStates);
  const best = new Map<string, { cost: Cost; key: string }>();
  const initial: QueueState = { node: startNode, nodes: [startNode], edges: [], cost: zeroCost(), key: startNode };
  heap.push(initial);
  best.set(startNode, { cost: initial.cost, key: initial.key });

  while (heap.size > 0) {
    const state = heap.pop()!;
    const stateBest = best.get(state.node);
    if (!stateBest || compareCost(state.cost, stateBest.cost) !== 0 || state.key !== stateBest.key) continue;
    if (state.node === SINK_NODE) return makePath(state.nodes, state.edges);

    for (const edge of neighbors(graph, fromStations, targetSet, state.node)) {
      if (options.bannedEdges?.has(edge.key)) continue;
      if (options.bannedNodes?.has(edge.to)) continue;
      if (state.nodes.includes(edge.to)) continue;

      const cost = addCost(state.cost, edge);
      const key = `${state.key}${NUL}${edge.key}`;
      const nextBest = best.get(edge.to);
      if (nextBest && !isBetter(cost, key, nextBest)) continue;

      best.set(edge.to, { cost, key });
      heap.push({
        node: edge.to,
        nodes: [...state.nodes, edge.to],
        edges: [...state.edges, edge],
        cost,
        key,
      });
    }
  }

  return null;
}

function neighbors(
  graph: RouteGraph,
  fromStations: string[],
  targetSet: Set<string>,
  node: string,
): RouteEdge[] {
  if (node === SINK_NODE) return [];
  if (node === SOURCE_NODE) {
    return [...fromStations].sort().map((to) => ({
      from: SOURCE_NODE,
      to,
      kind: 'source',
      lineChanges: 0,
      km: 0,
      key: edgeKey(SOURCE_NODE, to, 'source'),
    }));
  }

  const edges = graph.edges.get(node) ?? [];
  if (!targetSet.has(node)) return edges;
  return [
    ...edges,
    {
      from: node,
      to: SINK_NODE,
      kind: 'sink',
      lineChanges: 0,
      km: 0,
      key: edgeKey(node, SINK_NODE, 'sink'),
    },
  ];
}

function sameRoot(nodes: string[], rootNodes: string[]): boolean {
  if (nodes.length < rootNodes.length) return false;
  for (let i = 0; i < rootNodes.length; i += 1) {
    if (nodes[i] !== rootNodes[i]) return false;
  }
  return true;
}

function hasRepeatedNodes(nodes: string[]): boolean {
  return new Set(nodes).size !== nodes.length;
}

function actualStationCount(path: RoutePath): number {
  return path.nodes.filter((node) => node !== SOURCE_NODE && node !== SINK_NODE).length;
}

function makePath(nodes: string[], edges: RouteEdge[]): RoutePath {
  const segmentIds: string[] = [];
  const lines: string[] = [];
  const seenLines = new Set<string>();
  let lineChanges = 0;
  let km = 0;

  for (const edge of edges) {
    lineChanges += edge.lineChanges;
    km += edge.km;
    if (edge.segmentId) segmentIds.push(edge.segmentId);
    if (edge.lineId && !seenLines.has(edge.lineId)) {
      seenLines.add(edge.lineId);
      lines.push(edge.lineId);
    }
  }

  return {
    nodes,
    edges,
    cost: { lineChanges, km },
    segmentIds,
    lines,
    segmentKey: canonicalSegmentKey(segmentIds),
    pathKey: edges.map((edge) => edge.key).join(NUL),
  };
}

function candidateFromPath(path: RoutePath, railGeoVersion: string): RouteCandidate | null {
  if (path.segmentIds.length === 0 || path.lines.length === 0) return null;
  return {
    segmentIds: path.segmentIds,
    lines: path.lines,
    totalKm: path.cost.km,
    lineChanges: path.cost.lineChanges,
    railGeoVersion,
  };
}

function canonicalSegmentKey(segmentIds: string[]): string {
  return [...segmentIds].sort().join(NUL);
}

function compareCandidates(a: RouteCandidate, b: RouteCandidate): number {
  return (
    compareNumber(a.lineChanges, b.lineChanges) ||
    compareNumber(a.totalKm, b.totalKm) ||
    canonicalSegmentKey(a.segmentIds).localeCompare(canonicalSegmentKey(b.segmentIds)) ||
    a.segmentIds.join(NUL).localeCompare(b.segmentIds.join(NUL))
  );
}

function comparePaths(a: RoutePath, b: RoutePath): number {
  return (
    compareCost(a.cost, b.cost) ||
    a.segmentKey.localeCompare(b.segmentKey) ||
    a.pathKey.localeCompare(b.pathKey)
  );
}

function compareQueueStates(a: QueueState, b: QueueState): number {
  return compareCost(a.cost, b.cost) || a.key.localeCompare(b.key);
}

function compareCost(a: Cost, b: Cost): number {
  return compareNumber(a.lineChanges, b.lineChanges) || compareNumber(a.km, b.km);
}

function compareNumber(a: number, b: number): number {
  const diff = a - b;
  if (Math.abs(diff) <= EPS) return 0;
  return diff < 0 ? -1 : 1;
}

function isBetter(cost: Cost, key: string, current: { cost: Cost; key: string }): boolean {
  return compareCost(cost, current.cost) < 0 || (compareCost(cost, current.cost) === 0 && key < current.key);
}

function zeroCost(): Cost {
  return { lineChanges: 0, km: 0 };
}

function addCost(cost: Cost, edge: RouteEdge): Cost {
  return { lineChanges: cost.lineChanges + edge.lineChanges, km: cost.km + edge.km };
}

class MinHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const first = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return first;
  }

  private bubbleUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.compare(this.items[i], this.items[parent]) >= 0) break;
      [this.items[i], this.items[parent]] = [this.items[parent], this.items[i]];
      i = parent;
    }
  }

  private bubbleDown(index: number): void {
    let i = index;
    while (true) {
      const left = i * 2 + 1;
      const right = left + 1;
      let best = i;
      if (left < this.items.length && this.compare(this.items[left], this.items[best]) < 0) best = left;
      if (right < this.items.length && this.compare(this.items[right], this.items[best]) < 0) best = right;
      if (best === i) break;
      [this.items[i], this.items[best]] = [this.items[best], this.items[i]];
      i = best;
    }
  }
}
