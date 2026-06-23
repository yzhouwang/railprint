import type { Country, RailGeoPackage, RailLine, RailSegment, RailStation } from '../src/contract/types.ts';
import type { FeatureCollection, LineString, Position } from './geojson.ts';
import {
  lineLengthKm,
  projectPointOnLine,
  reverseLineString,
  sliceLineByDistance,
  sliceLoopLineByDistance,
} from './geometry.ts';
import { type SectionInput, stitchLineSections } from './stitch.ts';

export const JP_N02_ATTRIBUTION =
  '出典「国土数値情報（鉄道データ）」（国土交通省）を加工して作成';

export interface StationBuildInput {
  stationId?: string;
  name: string;
  lon: number;
  lat: number;
  seq?: number;
}

export interface LineBuildInput {
  lineId: string;
  name: string;
  country: Country;
  sections: SectionInput[];
  stations: StationBuildInput[];
  isLoop?: boolean;
  isHSR?: boolean;
  n02_002?: string | number;
  sequenceStrategy?: 'input' | 'project';
  arcDirection?: 'cw' | 'ccw';
}

export interface BuildInput {
  version: string;
  country: Country;
  generatedAt?: string;
  lines: LineBuildInput[];
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  lineId: string;
  message: string;
}

export interface ValidationReport {
  generatedAt: string;
  attribution: string;
  lines: {
    lineId: string;
    name: string;
    status: 'ok' | 'requires-override';
    issues: ValidationIssue[];
  }[];
}

export interface BuildResult {
  railGeoPackage: RailGeoPackage;
  validationReport: ValidationReport;
  segmentFeatures: FeatureCollection<LineString, SegmentFeatureProperties>;
}

export interface SegmentFeatureProperties extends Record<string, unknown> {
  segmentId: string;
  lineId: string;
  fromSeq: number;
  toSeq: number;
  km: number;
  isHSR: boolean;
}

interface SequencedStation {
  stationId: string;
  name: string;
  lon: number;
  lat: number;
  seq: number;
  alongKm: number;
  offsetKm: number;
}

// A station projecting further than this from its own line means a wrong-line
// station or a bad geocode — fail closed rather than ship plausible-but-wrong km.
const MAX_STATION_OFFSET_KM = 2;

export function buildRailGeoPackage(input: BuildInput): BuildResult {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const lines: RailLine[] = [];
  const segments: RailSegment[] = [];
  const stations: RailStation[] = [];
  const reportLines: ValidationReport['lines'] = [];

  for (const lineInput of input.lines) {
    const lineIssues: ValidationIssue[] = [];
    const stitched = stitchLineSections(lineInput.sections, { expectLoop: lineInput.isLoop });
    for (const issue of stitched.issues) {
      lineIssues.push({ ...issue, lineId: lineInput.lineId });
    }

    if (!stitched.ok || !stitched.line) {
      reportLines.push({
        lineId: lineInput.lineId,
        name: lineInput.name,
        status: 'requires-override',
        issues: lineIssues,
      });
      continue;
    }

    const isLoop = lineInput.isLoop ?? stitched.isLoop;

    const minStations = isLoop ? 3 : 2;
    if (lineInput.stations.length < minStations) {
      lineIssues.push({
        severity: 'error',
        code: 'insufficient-stations',
        lineId: lineInput.lineId,
        message: `Line has ${lineInput.stations.length} station(s); needs at least ${minStations} for coverage`,
      });
      reportLines.push({
        lineId: lineInput.lineId,
        name: lineInput.name,
        status: 'requires-override',
        issues: lineIssues,
      });
      continue;
    }

    let lineGeometry = stitched.line;
    let sequenced = sequenceStations(lineInput, lineGeometry);

    if (!isLoop && isStrictlyDecreasing(sequenced.map((station) => station.alongKm))) {
      lineGeometry = reverseLineString(lineGeometry);
      sequenced = sequenceStations(lineInput, lineGeometry);
    }

    if (!isLoop && !isNonDecreasing(sequenced.map((station) => station.alongKm))) {
      lineIssues.push({
        severity: 'error',
        code: 'station-order-not-monotonic',
        lineId: lineInput.lineId,
        message: 'Station sequence does not match stitched line direction',
      });
      reportLines.push({
        lineId: lineInput.lineId,
        name: lineInput.name,
        status: 'requires-override',
        issues: lineIssues,
      });
      continue;
    }

    if (isLoop && sequenced.length >= 3) {
      // A loop consistent with its stitched winding has exactly ONE cyclic descent
      // in alongKm (the wrap). Opposite winding shows n-1 descents, which makes every
      // forward slice take the LONG arc (3x km inflation). Reverse the geometry so the
      // forward slices are the short arc; fail closed if order is still inconsistent.
      const cyclicDescents = (vals: number[]): number => {
        let descents = 0;
        for (let i = 0; i < vals.length; i += 1) {
          if (vals[(i + 1) % vals.length] < vals[i]) descents += 1;
        }
        return descents;
      };
      if (cyclicDescents(sequenced.map((station) => station.alongKm)) === sequenced.length - 1) {
        lineGeometry = reverseLineString(lineGeometry);
        sequenced = sequenceStations(lineInput, lineGeometry);
      }
      if (cyclicDescents(sequenced.map((station) => station.alongKm)) !== 1) {
        lineIssues.push({
          severity: 'error',
          code: 'loop-station-order-not-monotonic',
          lineId: lineInput.lineId,
          message: 'Loop station sequence is not consistent with the stitched winding',
        });
        reportLines.push({
          lineId: lineInput.lineId,
          name: lineInput.name,
          status: 'requires-override',
          issues: lineIssues,
        });
        continue;
      }
    }

    const duplicateSeq = new Set<number>();
    const duplicateId = new Set<string>();
    const hasDuplicate = sequenced.some((station) => {
      if (duplicateSeq.has(station.seq) || duplicateId.has(station.stationId)) {
        return true;
      }
      duplicateSeq.add(station.seq);
      duplicateId.add(station.stationId);
      return false;
    });
    if (hasDuplicate) {
      lineIssues.push({
        severity: 'error',
        code: 'duplicate-station',
        lineId: lineInput.lineId,
        message: 'Line has duplicate station seq or stationId; segment ids would collide',
      });
      reportLines.push({
        lineId: lineInput.lineId,
        name: lineInput.name,
        status: 'requires-override',
        issues: lineIssues,
      });
      continue;
    }

    const offLine = sequenced.find((station) => station.offsetKm > MAX_STATION_OFFSET_KM);
    if (offLine) {
      lineIssues.push({
        severity: 'error',
        code: 'station-off-line',
        lineId: lineInput.lineId,
        message: `Station ${offLine.stationId} projects ${offLine.offsetKm.toFixed(2)}km from the line (> ${MAX_STATION_OFFSET_KM}km)`,
      });
      reportLines.push({
        lineId: lineInput.lineId,
        name: lineInput.name,
        status: 'requires-override',
        issues: lineIssues,
      });
      continue;
    }

    const isHSR = lineInput.isHSR ?? isN02BusinessOperatorTypeHSR(lineInput.n02_002);
    const stationIds = sequenced.map((station) => station.stationId);
    const railLine: RailLine = {
      lineId: lineInput.lineId,
      name: lineInput.name,
      country: lineInput.country,
      isHSR,
      isLoop,
      stationOrder: stationIds,
      geometry: lineGeometry,
    };
    lines.push(railLine);

    for (const station of sequenced) {
      stations.push({
        stationId: station.stationId,
        name: station.name,
        lineId: lineInput.lineId,
        seq: station.seq,
        lon: station.lon,
        lat: station.lat,
      });
    }

    segments.push(...buildSegments(lineInput, lineGeometry, sequenced, isLoop, isHSR));
    reportLines.push({
      lineId: lineInput.lineId,
      name: lineInput.name,
      status: lineIssues.some((issue) => issue.severity === 'error') ? 'requires-override' : 'ok',
      issues: lineIssues,
    });
  }

  const railGeoPackage: RailGeoPackage = {
    version: input.version,
    generatedAt,
    crs: 'WGS84',
    country: input.country,
    lines,
    segments,
    stations,
  };

  const validationReport: ValidationReport = {
    generatedAt,
    attribution: input.country === 'JP' ? JP_N02_ATTRIBUTION : 'OpenStreetMap contributors',
    lines: reportLines,
  };

  return {
    railGeoPackage,
    validationReport,
    segmentFeatures: toSegmentFeatureCollection(railGeoPackage),
  };
}

export function toSegmentFeatureCollection(
  railGeoPackage: RailGeoPackage,
): FeatureCollection<LineString, SegmentFeatureProperties> {
  return {
    type: 'FeatureCollection',
    features: railGeoPackage.segments.map((segment) => ({
      type: 'Feature',
      geometry: segment.geometry,
      properties: {
        segmentId: segment.segmentId,
        lineId: segment.lineId,
        fromSeq: segment.fromSeq,
        toSeq: segment.toSeq,
        km: segment.km,
        isHSR: segment.isHSR,
      },
    })),
  };
}

export function isN02BusinessOperatorTypeHSR(value: string | number | undefined): boolean {
  return String(value ?? '').trim() === '1';
}

function sequenceStations(lineInput: LineBuildInput, line: LineString): SequencedStation[] {
  const seeded = lineInput.stations.map((station, index) => {
    const stationId = station.stationId ?? `${lineInput.lineId}:station:${index + 1}`;
    const projection = projectPointOnLine([station.lon, station.lat], line);
    return {
      stationId,
      name: station.name,
      lon: station.lon,
      lat: station.lat,
      seq: station.seq ?? index + 1,
      alongKm: projection.alongKm,
      offsetKm: projection.distanceKm,
    };
  });

  if (lineInput.sequenceStrategy === 'project') {
    return seeded
      .sort((a, b) => a.alongKm - b.alongKm || a.stationId.localeCompare(b.stationId))
      .map((station, index) => ({ ...station, seq: index + 1 }));
  }

  return seeded.sort((a, b) => a.seq - b.seq || a.alongKm - b.alongKm);
}

function buildSegments(
  lineInput: LineBuildInput,
  line: LineString,
  stations: SequencedStation[],
  isLoop: boolean,
  isHSR: boolean,
): RailSegment[] {
  const count = isLoop ? stations.length : stations.length - 1;
  const segments: RailSegment[] = [];
  // Derive arc direction from the ACTUAL stitched winding (which may have been
  // reversed above), not the input label — the geometry the UI lights must match.
  const loopArcDirection = isLoop ? loopWinding(line) : (lineInput.arcDirection ?? 'cw');

  for (let i = 0; i < count; i += 1) {
    const from = stations[i];
    const to = stations[(i + 1) % stations.length];
    const geometry = isLoop
      ? sliceLoopLineByDistance(line, from.alongKm, to.alongKm)
      : sliceLineByDistance(line, from.alongKm, to.alongKm);
    const segment: RailSegment = {
      segmentId: `${lineInput.lineId}:${from.seq}-${to.seq}`,
      lineId: lineInput.lineId,
      fromStationId: from.stationId,
      toStationId: to.stationId,
      fromSeq: from.seq,
      toSeq: to.seq,
      km: roundKm(lineLengthKm(geometry)),
      isHSR,
      geometry,
    };
    if (isLoop) {
      segment.arcDirection = loopArcDirection;
    }
    segments.push(segment);
  }

  return segments;
}

function isNonDecreasing(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value >= values[index - 1]);
}

function isStrictlyDecreasing(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value < values[index - 1]);
}

function roundKm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// Shoelace signed area on the ring. sum(>0) ⇒ clockwise, (<0) ⇒ counter-clockwise
// for lon/lat with y pointing up (good enough at city scale for a cw/ccw label).
function loopWinding(line: LineString): 'cw' | 'ccw' {
  const c = line.coordinates;
  let sum = 0;
  for (let i = 1; i < c.length; i += 1) {
    sum += (c[i][0] - c[i - 1][0]) * (c[i][1] + c[i - 1][1]);
  }
  return sum > 0 ? 'cw' : 'ccw';
}

