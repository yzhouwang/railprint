import type { RailGeoPackage, RailLine } from '../src/contract/types.ts';
import { rankHistogram } from './line-rank.ts';
import type { RailLineRank } from './line-rank.ts';

export const PUBLISHED_KM_TOLERANCE = 0.12;

export interface CuratedAnchor {
  name: string;
  opMatch?: RegExp;
  km: number;
  loop?: boolean;
  stations?: number;
}

export const CURATED_ANCHORS: CuratedAnchor[] = [
  { name: '東海道新幹線', km: 515.4, stations: 17 },
  { name: '山陽新幹線', km: 553.7, stations: 19 },
  { name: '東北新幹線', opMatch: /東日本/, km: 674.9, stations: 23 },
  { name: '上越新幹線', opMatch: /東日本/, km: 269.5, stations: 10 },
  { name: '九州新幹線', km: 256.8, stations: 12 },
  { name: '北海道新幹線', km: 148.8, stations: 4 },
  { name: '山手線', opMatch: /東日本/, km: 20.6 },
  { name: '大阪環状線', km: 21.7, loop: true, stations: 19 },
  { name: '横須賀線', opMatch: /東日本/, km: 23.9, stations: 9 },
];

export type RankedLine = RailLine & { rank?: RailLineRank };

export function isRailLineRank(rank: unknown): rank is RailLineRank {
  return rank === 0 || rank === 1 || rank === 2 || rank === 3 || rank === 4;
}

export function lineKm(pkg: RailGeoPackage, id: string): number {
  return pkg.segments.filter((s) => s.lineId === id).reduce((a, s) => a + s.km, 0);
}

export function findCuratedAnchorLine(pkg: RailGeoPackage, anchor: CuratedAnchor): RailLine | undefined {
  return pkg.lines.find((line) => line.name === anchor.name && (!anchor.opMatch || anchor.opMatch.test(line.lineId)));
}

export function checkCuratedAnchor(
  pkg: RailGeoPackage,
  anchor: CuratedAnchor,
  tolerance = PUBLISHED_KM_TOLERANCE,
): {
  ok: boolean;
  line?: RailLine;
  km: number;
  deviation: number;
  kmOk: boolean;
  loopOk: boolean;
  stationCount?: number;
  stationOk: boolean;
} {
  const line = findCuratedAnchorLine(pkg, anchor);
  if (!line) {
    return { ok: false, km: 0, deviation: Infinity, kmOk: false, loopOk: false, stationOk: false };
  }
  const km = lineKm(pkg, line.lineId);
  const deviation = Math.abs(km - anchor.km) / anchor.km;
  const kmOk = deviation <= tolerance;
  const loopOk = anchor.loop === undefined || anchor.loop === line.isLoop;
  const stationCount = line.stationOrder.length;
  const stationOk = anchor.stations === undefined || anchor.stations === stationCount;
  return { ok: kmOk && loopOk && stationOk, line, km, deviation, kmOk, loopOk, stationCount, stationOk };
}

export function checkTier0HsrDenominator(pkg: RailGeoPackage): {
  ok: boolean;
  tier0Count: number;
  hsrLineCount: number;
  totalLineCount: number;
  hsrShare: number;
} {
  const lines = pkg.lines as RankedLine[];
  const ranks = rankHistogram(lines);
  const hsrLineCount = lines.filter((line) => line.isHSR).length;
  return {
    ok: ranks[0] === hsrLineCount,
    tier0Count: ranks[0],
    hsrLineCount,
    totalLineCount: lines.length,
    hsrShare: lines.length ? hsrLineCount / lines.length : 0,
  };
}
