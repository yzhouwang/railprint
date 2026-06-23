import type { LineString, Position } from './geojson.ts';

const EARTH_RADIUS_KM = 6371.0088;

export interface Projection {
  point: Position;
  alongKm: number;
  distanceKm: number;
  segmentIndex: number;
}

export function coordinateKey(coord: Position, precision = 6): string {
  return `${coord[0].toFixed(precision)},${coord[1].toFixed(precision)}`;
}

export function positionsEqual(a: Position, b: Position, precision = 6): boolean {
  return coordinateKey(a, precision) === coordinateKey(b, precision);
}

export function normalizeLineString(coords: Position[], precision = 9): Position[] {
  const normalized: Position[] = [];
  for (const coord of coords) {
    const point: Position = [coord[0], coord[1]];
    const previous = normalized[normalized.length - 1];
    if (!previous || !positionsEqual(previous, point, precision)) {
      normalized.push(point);
    }
  }
  return normalized;
}

export function reverseLineString(line: LineString): LineString {
  return { type: 'LineString', coordinates: [...line.coordinates].reverse() };
}

export function haversineKm(a: Position, b: Position): number {
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const deltaLat = toRadians(b[1] - a[1]);
  const deltaLon = toRadians(b[0] - a[0]);

  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lineLengthKm(lineOrCoords: LineString | Position[]): number {
  const coords = Array.isArray(lineOrCoords) ? lineOrCoords : lineOrCoords.coordinates;
  let km = 0;
  for (let i = 1; i < coords.length; i += 1) {
    km += haversineKm(coords[i - 1], coords[i]);
  }
  return km;
}

export function projectPointOnLine(point: Position, line: LineString): Projection {
  if (line.coordinates.length < 2) {
    throw new Error('Cannot project onto a line with fewer than two coordinates');
  }

  let best: Projection | undefined;
  let cumulativeKm = 0;

  for (let i = 1; i < line.coordinates.length; i += 1) {
    const start = line.coordinates[i - 1];
    const end = line.coordinates[i];
    const projected = projectPointOnSegment(point, start, end);
    const alongKm = cumulativeKm + haversineKm(start, projected);
    const distanceKm = haversineKm(point, projected);

    if (!best || distanceKm < best.distanceKm) {
      best = { point: projected, alongKm, distanceKm, segmentIndex: i - 1 };
    }

    cumulativeKm += haversineKm(start, end);
  }

  if (!best) {
    throw new Error('Could not project point onto line');
  }
  return best;
}

export function sliceLineByDistance(line: LineString, fromKm: number, toKm: number): LineString {
  if (fromKm < 0 || toKm < 0) {
    throw new Error('Cannot slice a line with negative distances');
  }
  if (toKm < fromKm) {
    throw new Error(`Cannot slice a non-wrapping line backwards: ${fromKm} > ${toKm}`);
  }

  const totalKm = lineLengthKm(line);
  const startKm = clamp(fromKm, 0, totalKm);
  const endKm = clamp(toKm, 0, totalKm);
  if (startKm === endKm) {
    const point = interpolateAtDistance(line, startKm);
    return { type: 'LineString', coordinates: [point, point] };
  }

  const coords: Position[] = [];
  let cumulativeKm = 0;

  for (let i = 1; i < line.coordinates.length; i += 1) {
    const a = line.coordinates[i - 1];
    const b = line.coordinates[i];
    const segmentKm = haversineKm(a, b);
    const segmentStart = cumulativeKm;
    const segmentEnd = cumulativeKm + segmentKm;
    cumulativeKm = segmentEnd;

    if (segmentEnd < startKm || segmentStart > endKm) {
      continue;
    }

    if (startKm >= segmentStart && startKm <= segmentEnd) {
      appendPosition(coords, interpolateBetween(a, b, ratio(startKm - segmentStart, segmentKm)));
    } else if (segmentStart >= startKm && segmentStart <= endKm) {
      appendPosition(coords, a);
    }

    if (endKm >= segmentStart && endKm <= segmentEnd) {
      appendPosition(coords, interpolateBetween(a, b, ratio(endKm - segmentStart, segmentKm)));
      break;
    }

    if (segmentEnd <= endKm) {
      appendPosition(coords, b);
    }
  }

  if (coords.length < 2) {
    const start = interpolateAtDistance(line, startKm);
    const end = interpolateAtDistance(line, endKm);
    return { type: 'LineString', coordinates: [start, end] };
  }

  return { type: 'LineString', coordinates: normalizeLineString(coords) };
}

export function sliceLoopLineByDistance(line: LineString, fromKm: number, toKm: number): LineString {
  const totalKm = lineLengthKm(line);
  if (fromKm <= toKm) {
    return sliceLineByDistance(line, fromKm, toKm);
  }

  const first = sliceLineByDistance(line, fromKm, totalKm).coordinates;
  const second = sliceLineByDistance(line, 0, toKm).coordinates;
  return { type: 'LineString', coordinates: normalizeLineString([...first, ...second]) };
}

export function interpolateAtDistance(line: LineString, targetKm: number): Position {
  const totalKm = lineLengthKm(line);
  const clampedTarget = clamp(targetKm, 0, totalKm);
  let cumulativeKm = 0;

  for (let i = 1; i < line.coordinates.length; i += 1) {
    const a = line.coordinates[i - 1];
    const b = line.coordinates[i];
    const segmentKm = haversineKm(a, b);
    const nextKm = cumulativeKm + segmentKm;
    if (clampedTarget <= nextKm) {
      return interpolateBetween(a, b, ratio(clampedTarget - cumulativeKm, segmentKm));
    }
    cumulativeKm = nextKm;
  }

  return line.coordinates[line.coordinates.length - 1];
}

function projectPointOnSegment(point: Position, start: Position, end: Position): Position {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return start;
  }

  const t = clamp(((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared, 0, 1);
  return [start[0] + t * dx, start[1] + t * dy];
}

function interpolateBetween(a: Position, b: Position, t: number): Position {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function appendPosition(coords: Position[], coord: Position): void {
  const previous = coords[coords.length - 1];
  if (!previous || !positionsEqual(previous, coord, 9)) {
    coords.push(coord);
  }
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return clamp(numerator / denominator, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

