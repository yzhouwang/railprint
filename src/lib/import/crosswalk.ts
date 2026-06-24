// The CROSSWALK (T4 core): incumbent line/station NAMES (+ optional coords) → our
// N02/ekidata-derived segmentIds, via the geo index built from the RailGeoPackage.
//
// The incumbent (乗りつぶしオンライン / RailLab) is a web-1.0 free-text world: names carry
// 旧字 (old-form kanji 澁谷/驛), fullwidth/halfwidth drift, 「駅」/「線」 suffixes, JR vs
// non-JR prefixes, and the SAME station name appears on many lines (transfer stations
// like 渋谷, 東京). So matching is fuzzy, ranked, and HONEST: when it cannot be sure it
// returns ranked suggestions for the human review screen (D2) instead of guessing.
//
// Ranking = bigram-Dice name similarity (on a normalized form) blended with coordinate
// proximity (haversineKm — point distance only, never network geometry). A clean win
// (one strong candidate, clearly ahead of the rest) → 'matched'; a near-tie among
// several plausible candidates → 'ambiguous'; nothing plausible → 'unmatched'.

import type { RailGeoPackage, RailLine, RailStation } from '../../contract/types';
import type { GeoIndex } from '../store';
import { haversineKm } from '../geo';

// ───────────────────────────── name normalization ───────────────────────────

// 旧字（旧字体）→ 新字体. Small, targeted table for the station/line glyphs that actually
// drift in incumbent exports — not a full Unicode old→new map. Extend as real data shows.
const OLD_TO_NEW: Record<string, string> = {
  澁: '渋', // 澁谷 → 渋谷
  驛: '駅',
  櫻: '桜',
  濱: '浜', // 横濱 → 横浜
  廣: '広',
  邊: '辺',
  邉: '辺',
  齋: '斎',
  髙: '高', // はしごだか → 高
  﨑: '崎',
  靑: '青',
  眞: '真',
  國: '国',
  學: '学', // 學藝大學 → 学芸大学(部分)
  藝: '芸',
  區: '区',
  澤: '沢',
  瀨: '瀬',
  龍: '竜',
  與: '与',
};

/** Convert fullwidth ASCII + fullwidth space to halfwidth, and 旧字 → 新字. */
function foldGlyphs(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    // Fullwidth ASCII range ！(FF01)..～(FF5E) → halfwidth.
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCodePoint(code - 0xfee0);
    } else if (code === 0x3000) {
      out += ' '; // ideographic space
    } else {
      out += OLD_TO_NEW[ch] ?? ch;
    }
  }
  return out;
}

// Suffixes/affixes that incumbent free-text carries but the canonical name may not (or
// vice-versa). Stripped for the *comparison key* only — never shown to the user.
const STATION_SUFFIX = /駅$/;
// Order matters: strip parentheticals first so a trailing 線 is exposed, e.g.
// 「中央線(快速)」→「中央線」→「中央」.
const LINE_AFFIXES: RegExp[] = [
  /\(.*\)$/, // 「中央線(快速)」→「中央線」
  /（.*）$/,
  /^JR/i,
  /線$/,
];

function stripAll(s: string, patterns: RegExp[]): string {
  let out = s;
  for (const p of patterns) out = out.replace(p, '');
  return out;
}

/** Comparison key for a STATION name: glyph-folded, suffix-stripped, despaced, lowercased. */
export function normStation(name: string): string {
  return stripAll(foldGlyphs(name).trim(), [STATION_SUFFIX])
    .replace(/[\s・･]/g, '')
    .toLowerCase();
}

/** Comparison key for a LINE name: glyph-folded, affix-stripped, despaced, lowercased. */
export function normLine(name: string): string {
  return stripAll(foldGlyphs(name).trim(), LINE_AFFIXES)
    .replace(/[\s・･]/g, '')
    .toLowerCase();
}

// ───────────────────────────── similarity ───────────────────────────────────

/** Character bigrams of a string (single-char strings yield the char itself). */
function bigrams(s: string): string[] {
  if (s.length <= 1) return s ? [s] : [];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/**
 * Sørensen–Dice coefficient over character bigrams, 0..1. Robust for short CJK names
 * and order-insensitive enough to absorb minor drift, while an exact match scores 1.
 */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 || B.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of B) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      overlap++;
      counts.set(g, c - 1);
    }
  }
  return (2 * overlap) / (A.length + B.length);
}

// ───────────────────────────── candidate scoring ────────────────────────────

export interface CrosswalkInput {
  /** raw station text (the leg endpoint or, for a 区間 row, one endpoint). */
  rawName: string;
  /** raw line text, if the incumbent CSV carried a 路線 column. */
  rawLineName?: string;
  lon?: number;
  lat?: number;
}

export interface StationCandidate {
  station: RailStation;
  line: RailLine;
  /** 0..1 — name similarity blended with coordinate proximity. */
  confidence: number;
  nameScore: number;
  /** kilometres from the input coord to this station, if a coord was supplied. */
  distanceKm?: number;
}

// Tuning constants. Calibrated for the stub package's transfer-heavy Tokyo data; the
// spike doc (docs/agents/spike-crosswalk.md) is not present, so these are conservative.
const COORD_NEAR_KM = 1.5; // within this, treat as essentially the same point
const COORD_FAR_KM = 25; // beyond this, coordinate proximity contributes ~nothing
const NAME_FLOOR = 0.34; // below this name score, a candidate isn't plausible at all
const COORD_WEIGHT = 0.35; // share of confidence from coords when a coord is present
const MATCH_MIN = 0.62; // top candidate must clear this to auto-match
const MATCH_LEAD = 0.12; // …and lead the runner-up by this much to be unambiguous

/** Proximity score 0..1 from a point distance (1 = co-located, 0 = far/unknown). */
function proximityScore(km: number | undefined): number {
  if (km === undefined) return 0;
  if (km <= COORD_NEAR_KM) return 1;
  if (km >= COORD_FAR_KM) return 0;
  return 1 - (km - COORD_NEAR_KM) / (COORD_FAR_KM - COORD_NEAR_KM);
}

/**
 * Score every station in the package against the input, returning plausible candidates
 * ranked best-first. A station appears once PER LINE it sits on (transfer stations like
 * 渋谷 are genuinely different coverage targets on each line), so the review screen can
 * disambiguate by line.
 */
export function scoreStationCandidates(input: CrosswalkInput, geo: GeoIndex): StationCandidate[] {
  const targetStation = normStation(input.rawName);
  const targetLine = input.rawLineName ? normLine(input.rawLineName) : undefined;
  const hasCoord = input.lon !== undefined && input.lat !== undefined;

  const out: StationCandidate[] = [];
  for (const station of geo.stationById.values()) {
    const line = geo.lineById.get(station.lineId);
    if (!line) continue;

    const nameScore = diceSimilarity(targetStation, normStation(station.name));

    // A line constraint, when present, gates AND boosts: a wrong-line candidate for a
    // transfer station is demoted hard so the right line floats to the top.
    let lineScore = 1;
    if (targetLine) {
      lineScore = diceSimilarity(targetLine, normLine(line.name));
    }

    const distanceKm = hasCoord
      ? haversineKm({ lon: input.lon!, lat: input.lat! }, { lon: station.lon, lat: station.lat })
      : undefined;
    const proximity = proximityScore(distanceKm);

    // Name is the spine of the score. Coords refine it (proximity can rescue an exact
    // co-located station whose romanization drifted, and breaks transfer-name ties).
    let confidence = hasCoord
      ? nameScore * (1 - COORD_WEIGHT) + proximity * COORD_WEIGHT
      : nameScore;

    // Apply the line gate multiplicatively when a line was supplied.
    if (targetLine) confidence *= 0.5 + 0.5 * lineScore;

    // Reject implausible names outright (unless the coord is a near-perfect lock-on,
    // which can carry a renamed station).
    if (nameScore < NAME_FLOOR && proximity < 1) continue;

    out.push({ station, line, confidence, nameScore, distanceKm });
  }

  out.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    // Deterministic tie-break: closer coord, then stationId.
    const da = a.distanceKm ?? Infinity;
    const dbk = b.distanceKm ?? Infinity;
    if (da !== dbk) return da - dbk;
    return a.station.stationId < b.station.stationId ? -1 : 1;
  });
  return out;
}

export type ResolutionVerdict =
  | { status: 'matched'; best: StationCandidate }
  | { status: 'ambiguous'; candidates: StationCandidate[] }
  | { status: 'unmatched'; candidates: StationCandidate[] };

/**
 * Decide a single station resolution from the ranked candidates. Clean win → matched;
 * a plausible field that doesn't clearly separate → ambiguous; nothing plausible →
 * unmatched. NEVER silently picks among a tie (DESIGN issue 2).
 */
export function resolveStation(input: CrosswalkInput, geo: GeoIndex): ResolutionVerdict {
  const candidates = scoreStationCandidates(input, geo);
  if (candidates.length === 0) return { status: 'unmatched', candidates: [] };

  const top = candidates[0];
  const runnerUp = candidates[1];
  const clearLead = !runnerUp || top.confidence - runnerUp.confidence >= MATCH_LEAD;

  if (top.confidence >= MATCH_MIN && clearLead) {
    return { status: 'matched', best: top };
  }
  // Surface the strongest few for the human; keep it short so D2 stays scannable.
  return {
    status: top.confidence >= MATCH_MIN || candidates.length > 1 ? 'ambiguous' : 'unmatched',
    candidates: candidates.slice(0, 5),
  };
}

// ───────────────────────────── segment resolution ───────────────────────────

/** Find the inter-station segment that joins two consecutive stations on one line. */
export function segmentJoining(
  lineId: string,
  stationIdA: string,
  stationIdB: string,
  pkg: RailGeoPackage,
): string | undefined {
  for (const seg of pkg.segments) {
    if (seg.lineId !== lineId) continue;
    if (
      (seg.fromStationId === stationIdA && seg.toStationId === stationIdB) ||
      (seg.fromStationId === stationIdB && seg.toStationId === stationIdA)
    ) {
      return seg.segmentId;
    }
  }
  return undefined;
}
