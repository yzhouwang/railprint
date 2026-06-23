import type { LineString, Position } from './geojson.ts';
import { coordinateKey, normalizeLineString, positionsEqual } from './geometry.ts';

export interface SectionInput {
  sectionId: string;
  coordinates: Position[];
  sourceProperties?: Record<string, unknown>;
}

export interface StitchIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface StitchResult {
  ok: boolean;
  line?: LineString;
  isLoop: boolean;
  sectionOrder: string[];
  issues: StitchIssue[];
}

interface GraphEdge {
  index: number;
  sectionId: string;
  aKey: string;
  bKey: string;
  coordinates: Position[];
}

export function stitchLineSections(
  sections: SectionInput[],
  options: { endpointPrecision?: number; expectLoop?: boolean } = {},
): StitchResult {
  const precision = options.endpointPrecision ?? 6;
  const issues: StitchIssue[] = [];

  if (sections.length === 0) {
    return fail('empty-line', 'Cannot stitch a line with no sections');
  }

  const edges: GraphEdge[] = [];
  const adjacency = new Map<string, GraphEdge[]>();

  for (const [index, section] of sections.entries()) {
    const coords = normalizeLineString(section.coordinates);
    if (coords.length < 2) {
      issues.push({
        severity: 'error',
        code: 'short-section',
        message: `Section ${section.sectionId} has fewer than two unique coordinates`,
      });
      continue;
    }

    const aKey = coordinateKey(coords[0], precision);
    const bKey = coordinateKey(coords[coords.length - 1], precision);
    const edge: GraphEdge = { index, sectionId: section.sectionId, aKey, bKey, coordinates: coords };
    edges.push(edge);
    push(adjacency, aKey, edge);
    push(adjacency, bKey, edge);
  }

  if (issues.some((issue) => issue.severity === 'error')) {
    return { ok: false, isLoop: false, sectionOrder: [], issues };
  }

  const connectedIssue = validateConnected(edges, adjacency);
  if (connectedIssue) {
    issues.push(connectedIssue);
  }

  const degrees = [...adjacency.entries()].map(([key, nodeEdges]) => ({ key, degree: nodeEdges.length }));
  const branchNodes = degrees.filter((node) => node.degree > 2);
  if (branchNodes.length > 0) {
    issues.push({
      severity: 'error',
      code: 'branching-line',
      message: `Line has branch nodes at ${branchNodes.map((node) => node.key).join(', ')}`,
    });
  }

  const endpoints = degrees.filter((node) => node.degree === 1).map((node) => node.key).sort();
  const isLoop = endpoints.length === 0;
  if (!isLoop && endpoints.length !== 2) {
    issues.push({
      severity: 'error',
      code: 'invalid-endpoints',
      message: `Expected exactly two endpoints for an open line, found ${endpoints.length}`,
    });
  }
  if (options.expectLoop === true && !isLoop) {
    issues.push({
      severity: 'error',
      code: 'expected-loop',
      message: 'Line was marked as loop but stitched graph is not closed',
    });
  }

  if (issues.some((issue) => issue.severity === 'error')) {
    return { ok: false, isLoop, sectionOrder: [], issues };
  }

  const startKey = isLoop ? [...adjacency.keys()].sort()[0] : endpoints[0];
  const stitched = walkEdges(startKey, edges, adjacency);
  if (stitched.usedEdgeCount !== edges.length) {
    issues.push({
      severity: 'error',
      code: 'walk-incomplete',
      message: `Stitched ${stitched.usedEdgeCount}/${edges.length} sections`,
    });
    return { ok: false, isLoop, sectionOrder: stitched.sectionOrder, issues };
  }

  const coordinates = normalizeLineString(stitched.coordinates);
  if (isLoop && !positionsEqual(coordinates[0], coordinates[coordinates.length - 1], precision)) {
    coordinates.push(coordinates[0]);
  }

  return {
    ok: true,
    isLoop,
    sectionOrder: stitched.sectionOrder,
    line: { type: 'LineString', coordinates },
    issues,
  };

  function fail(code: string, message: string): StitchResult {
    return { ok: false, isLoop: false, sectionOrder: [], issues: [{ severity: 'error', code, message }] };
  }
}

function walkEdges(
  startKey: string,
  edges: GraphEdge[],
  adjacency: Map<string, GraphEdge[]>,
): { coordinates: Position[]; sectionOrder: string[]; usedEdgeCount: number } {
  const used = new Set<number>();
  const coordinates: Position[] = [];
  const sectionOrder: string[] = [];
  let currentKey = startKey;

  for (let step = 0; step < edges.length; step += 1) {
    const candidates = (adjacency.get(currentKey) ?? [])
      .filter((edge) => !used.has(edge.index))
      .sort((a, b) => a.sectionId.localeCompare(b.sectionId));
    const edge = candidates[0];
    if (!edge) {
      break;
    }

    const oriented = edge.aKey === currentKey ? edge.coordinates : [...edge.coordinates].reverse();
    if (coordinates.length === 0) {
      coordinates.push(...oriented);
    } else {
      coordinates.push(...oriented.slice(1));
    }

    used.add(edge.index);
    sectionOrder.push(edge.sectionId);
    currentKey = edge.aKey === currentKey ? edge.bKey : edge.aKey;
  }

  return { coordinates, sectionOrder, usedEdgeCount: used.size };
}

function validateConnected(
  edges: GraphEdge[],
  adjacency: Map<string, GraphEdge[]>,
): StitchIssue | undefined {
  const first = edges[0];
  if (!first) {
    return undefined;
  }

  const seenNodes = new Set<string>();
  const seenEdges = new Set<number>();
  const queue = [first.aKey];
  seenNodes.add(first.aKey);

  while (queue.length > 0) {
    const key = queue.shift();
    if (!key) {
      continue;
    }

    for (const edge of adjacency.get(key) ?? []) {
      seenEdges.add(edge.index);
      const nextKey = edge.aKey === key ? edge.bKey : edge.aKey;
      if (!seenNodes.has(nextKey)) {
        seenNodes.add(nextKey);
        queue.push(nextKey);
      }
    }
  }

  if (seenEdges.size !== edges.length) {
    return {
      severity: 'error',
      code: 'disconnected-line',
      message: `Line has ${edges.length - seenEdges.size} disconnected section(s)`,
    };
  }
  return undefined;
}

function push(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(edge);
  } else {
    map.set(key, [edge]);
  }
}

