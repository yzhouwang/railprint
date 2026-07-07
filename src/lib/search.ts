// Station-FIRST bilingual search + line inference (C2 + C3).
//
// The mark flow can start from a TAP (MapView, exists) or from TYPING a station name. This
// module owns the typed path: resolve a free-text query (日本語 / かな / romaji) to the set of
// matching station instances, then — given two resolved stations — infer the line connecting
// them by intersecting the lines each station's cross-line GROUP sits on.
//
// REUSE, don't rebuild: name normalization + Dice similarity come from the crosswalk (T4);
// we do NOT duplicate the OLD_TO_NEW kanji table. `wanakana` is LAZY-loaded (only when a query
// needs kana↔romaji folding) so it never costs the map's first paint.

import type { RailGeoPackage, RailLine, RailStation, RouteCandidate } from '../contract/types';
import type { GeoIndex, StationGroupMember } from './geo-index';
import { groupKeyOf } from './geo-index';
import { normStation } from './import/crosswalk';
import { segmentsBetween } from './resolver';

// ───────────────────────────── romaji normalization ─────────────────────────

// Macron / circumflex long-vowel marks → plain ASCII vowel. Incumbent + OSM romaji drift
// between 新宿=Shinjuku, 大阪=Ōsaka/Osaka/Oosaka; we fold them all to a bare-vowel key.
const MACRONS: Record<string, string> = {
  ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o',
  â: 'a', î: 'i', û: 'u', ê: 'e', ô: 'o',
  Ā: 'a', Ī: 'i', Ū: 'u', Ē: 'e', Ō: 'o',
};

/** Comparison key for a ROMAJI name: lowercase, strip macrons, drop hyphens/spaces/apostrophes. */
export function normRoma(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) out += MACRONS[ch] ?? ch;
  // Drop separators that drift (Shin-Okubo / Shin Okubo / ShinOkubo) and the apostrophe in
  // Den-en / San'no. Long-vowel "oo"/"ou" left as-is — macron fold already covers the marked form.
  return out.replace(/[\s'’\-・･]/g, '');
}

/** True iff the string contains any CJK ideograph or kana (i.e. needs no romaji probe to match JP). */
export function looksJapanese(s: string): boolean {
  return /[　-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/.test(s);
}

/** True iff the string contains kana specifically (hiragana/katakana) — needs wanakana to romanize. */
function hasKana(s: string): boolean {
  return /[぀-ヿｦ-ﾟ]/.test(s);
}

// ───────────────────────────── bilingual index ──────────────────────────────

export interface StationHit {
  station: RailStation;
  line: RailLine;
  /** 0..1 — 1 for an exact name/romaji key hit, otherwise the Dice similarity. */
  score: number;
  /** true when the query keyed an EXACT normalized name or romaji match (not fuzzy). */
  exact: boolean;
}

/**
 * A precomputed bigram MULTISET (counts + total bigram count). The fuzzy fallback runs a Dice
 * comparison against every station instance on every resolve; recomputing normStation/normRoma
 * + slicing bigrams from scratch per query made each keystroke an O(N × normalize) scan. The
 * index now bakes these once at build; per-query cost is a Map-lookup intersection only.
 */
export interface BigramSet {
  counts: Map<string, number>;
  total: number;
}

/** Bigram multiset of a (pre-normalized) key. Mirrors crosswalk's bigrams(): 1-char → itself. */
export function bigramSet(s: string): BigramSet {
  const counts = new Map<string, number>();
  if (s.length === 1) {
    counts.set(s, 1);
    return { counts, total: 1 };
  }
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return { counts, total: Math.max(0, s.length - 1) };
}

/**
 * Sørensen–Dice over two precomputed bigram multisets — numerically IDENTICAL to crosswalk's
 * diceSimilarity(a, b) on the same keys (multiset intersection ÷ mean size), just without the
 * per-call normalization + bigram slicing. Empty either side → 0, like the string form.
 */
export function diceFromSets(a: BigramSet, b: BigramSet): number {
  if (a.total === 0 || b.total === 0) return 0;
  // Iterate the smaller distinct-bigram side (the query, in practice — a few chars).
  const [small, big] = a.counts.size <= b.counts.size ? [a, b] : [b, a];
  let overlap = 0;
  for (const [g, c] of small.counts) {
    const other = big.counts.get(g);
    if (other) overlap += Math.min(c, other);
  }
  return (2 * overlap) / (a.total + b.total);
}

export interface SearchIndex {
  /** normStation(name) → station instances (a transfer name keys many instances). */
  byName: Map<string, StationHit[]>;
  /** normRoma(nameRoma) → station instances (undefined for the ~3% without nameRoma). */
  byRoma: Map<string, StationHit[]>;
  /**
   * Flat list of every (station,line) instance — the fuzzy fallback scans this. Each entry
   * carries its normalized-name bigrams precomputed (romaGrams null when nameRoma is absent
   * or normalizes to nothing), so resolveQuery never re-normalizes a station per keystroke.
   */
  all: { station: RailStation; line: RailLine; nameGrams: BigramSet; romaGrams: BigramSet | null }[];
}

/** Build the bilingual lookup index once at boot (cheap; ~10k stations). Pure. */
export function buildSearchIndex(geo: GeoIndex): SearchIndex {
  const byName = new Map<string, StationHit[]>();
  const byRoma = new Map<string, StationHit[]>();
  const all: SearchIndex['all'] = [];
  const push = (m: Map<string, StationHit[]>, key: string, hit: StationHit): void => {
    if (!key) return;
    (m.get(key) ?? m.set(key, []).get(key)!).push(hit);
  };
  for (const station of geo.stationById.values()) {
    const line = geo.lineById.get(station.lineId);
    if (!line) continue;
    const nameKey = normStation(station.name);
    const romaKey = station.nameRoma ? normRoma(station.nameRoma) : '';
    all.push({
      station,
      line,
      nameGrams: bigramSet(nameKey),
      romaGrams: romaKey ? bigramSet(romaKey) : null,
    });
    const hit: StationHit = { station, line, score: 1, exact: true };
    push(byName, nameKey, hit);
    if (station.nameRoma) push(byRoma, romaKey, hit);
  }
  return { byName, byRoma, all };
}

// ───────────────────────────── query resolution ─────────────────────────────

const FUZZY_FLOOR = 0.5; // below this similarity a fuzzy candidate isn't offered

/**
 * Resolve a typed query to station instances, EXACT-MATCH FIRST. Returns ALL matches (no
 * 5-cap — 住吉 legitimately appears on many lines, 新宿 keys 7 line-instances). When the typed
 * input is kana or romaji, `wanakana` (lazy) folds it so しんじゅく / shinjuku / 新宿 all resolve.
 *
 * Order: exact JP-name key → exact romaji key → (kana/romaji folded) romaji key → fuzzy scan.
 * Within a tier results are sorted by line name for a stable picker order.
 */
export async function resolveQuery(raw: string, index: SearchIndex): Promise<StationHit[]> {
  const q = raw.trim();
  if (!q) return [];

  // 1) Exact 日本語 name key (新宿駅 / 新宿 both normalize to the same key via normStation).
  const nameKey = normStation(q);
  const byNameExact = index.byName.get(nameKey);
  if (byNameExact && byNameExact.length) return sortHits(dedupe(byNameExact));

  // 2) Exact romaji key on the raw input (already-romaji query: "shinjuku", "Shin-Okubo").
  const romaKey = normRoma(q);
  const direct = index.byRoma.get(romaKey);
  if (direct && direct.length) return sortHits(dedupe(direct));

  // 3) Fold the query through wanakana and retry the romaji index. This rescues kana input
  //    (しんじゅく → shinjuku) and romaji-with-kana mixes. Loaded lazily — only typed searches
  //    that missed the cheap keys pay for it, never the map's first paint.
  if (!looksJapanese(q) || hasKana(q)) {
    const folded = await foldToRomaji(q);
    if (folded && folded !== romaKey) {
      const viaKana = index.byRoma.get(folded);
      if (viaKana && viaKana.length) return sortHits(dedupe(viaKana));
    }
  }

  // 4) Fuzzy fallback — Dice over the JP name (kanji input) and over romaji (latin input).
  //    The query's bigrams are built ONCE here; each station comparison is then a pure
  //    multiset intersection against the index's precomputed grams (no re-normalization).
  const romaProbe = looksJapanese(q) && !hasKana(q) ? '' : (await foldToRomaji(q)) || romaKey;
  const nameProbeGrams = nameKey ? bigramSet(nameKey) : null;
  const romaProbeGrams = romaProbe ? bigramSet(romaProbe) : null;
  const scored: StationHit[] = [];
  for (const { station, line, nameGrams, romaGrams } of index.all) {
    const nameScore = nameProbeGrams ? diceFromSets(nameProbeGrams, nameGrams) : 0;
    const romaScore = romaProbeGrams && romaGrams ? diceFromSets(romaProbeGrams, romaGrams) : 0;
    const score = Math.max(nameScore, romaScore);
    if (score >= FUZZY_FLOOR) scored.push({ station, line, score, exact: false });
  }
  scored.sort((a, b) => b.score - a.score || cmpLine(a, b));
  return dedupe(scored);
}

/** Lazy wanakana fold: kana/romaji → a normalized romaji key. Empty on failure. */
let wk: typeof import('wanakana') | null = null;
async function foldToRomaji(q: string): Promise<string> {
  try {
    wk ??= await import('wanakana');
    // toRomaji passes ASCII through and converts kana; kanji it leaves intact (drops out in normRoma).
    return normRoma(wk.toRomaji(q));
  } catch {
    return '';
  }
}

function dedupe(hits: StationHit[]): StationHit[] {
  const seen = new Set<string>();
  const out: StationHit[] = [];
  for (const h of hits) {
    if (seen.has(h.station.stationId)) continue;
    seen.add(h.station.stationId);
    out.push(h);
  }
  return out;
}

function cmpLine(a: StationHit, b: StationHit): number {
  return a.line.name.localeCompare(b.line.name);
}
function sortHits(hits: StationHit[]): StationHit[] {
  return [...hits].sort(cmpLine);
}

// ───────────────────────────── line inference (C3) ───────────────────────────

/** A line that connects A and B, with the concrete from/to station ids on THAT line. */
export interface LineCandidate {
  line: RailLine;
  fromStationId: string;
  toStationId: string;
  segmentIds: string[];
}

export type LineInference =
  | { status: 'one'; candidate: LineCandidate }
  | { status: 'many'; candidates: LineCandidate[] }
  | { status: 'none' };

/**
 * Infer the line(s) joining the physical stations behind two resolved hits. Each hit maps to a
 * cross-line GROUP; we intersect the lines those groups sit on and keep only lines where
 * `segmentsBetween` actually returns a path (guards a same-name-different-place collision, and
 * a gap in a stitched line). Single shared line → 'one'; several → 'many' (picker); none → 'none'.
 */
export function inferLine(
  aGroupKey: string,
  bGroupKey: string,
  geo: GeoIndex,
  packages: RailGeoPackage[],
): LineInference {
  const aMembers = geo.stationGroupById.get(aGroupKey) ?? [];
  const bMembers = geo.stationGroupById.get(bGroupKey) ?? [];
  const bByLine = new Map<string, StationGroupMember>();
  for (const m of bMembers) bByLine.set(m.lineId, m);

  const pkgOfLine = (lineId: string): RailGeoPackage | undefined =>
    packages.find((p) => p.lines.some((l) => l.lineId === lineId));

  const candidates: LineCandidate[] = [];
  const seenLines = new Set<string>();
  for (const a of aMembers) {
    const b = bByLine.get(a.lineId);
    if (!b || seenLines.has(a.lineId)) continue;
    if (a.stationId === b.stationId) continue; // same instance — nothing to ride
    seenLines.add(a.lineId);
    const line = geo.lineById.get(a.lineId);
    const pkg = pkgOfLine(a.lineId);
    if (!line || !pkg) continue;
    let segmentIds: string[];
    try {
      segmentIds = segmentsBetween(a.lineId, a.stationId, b.stationId, pkg);
    } catch {
      continue; // no path on this line (gap / not actually adjacent on the stitched order)
    }
    if (segmentIds.length === 0) continue;
    candidates.push({ line, fromStationId: a.stationId, toStationId: b.stationId, segmentIds });
  }

  if (candidates.length === 0) return { status: 'none' };
  if (candidates.length === 1) return { status: 'one', candidate: candidates[0] };
  candidates.sort((x, y) => x.line.name.localeCompare(y.line.name));
  return { status: 'many', candidates };
}

/** The cross-line group key for a resolved hit — the inference unit. */
export function groupKeyForHit(hit: StationHit): string {
  return groupKeyOf(hit.station);
}

/**
 * Order route candidates so a single-line route on a line the user EXPLICITLY picked in search comes
 * first. findRoutes ranks 0-change routes purely by km, which can float a parallel Shinkansen (one
 * short hop between two stations that also share a local line) ABOVE the local line the user obviously
 * rode — one tap from a phantom HSR mark that inflates the HSR %. findRoutes works on group keys and
 * can't know which instance was picked; the UI can. Stable: preserves findRoutes' order within each
 * partition, so the route-finder's (lineChanges, km) ranking still governs everything else.
 */
export function preferPickedLine(routes: RouteCandidate[], pickedLineIds: Set<string>): RouteCandidate[] {
  const onPicked: RouteCandidate[] = [];
  const rest: RouteCandidate[] = [];
  for (const r of routes) {
    if (r.lines.length === 1 && pickedLineIds.has(r.lines[0])) onPicked.push(r);
    else rest.push(r);
  }
  return [...onPicked, ...rest];
}

/** Bilingual display label: `新宿 (Shinjuku)` when a reading exists, else just 新宿. */
export function bilingualLabel(name: string, nameRoma?: string): string {
  return nameRoma ? `${name} (${nameRoma})` : name;
}
