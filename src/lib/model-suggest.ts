// 車両 suggestion chips v3 (v0.13.1 plausibility gate; v2 was plan D8 / review 5A) — PURE lib.
// MapView owns the wiring (passes $events + the selected line + a memoized geo-index
// segment→line lookup); this module only ranks. Stored trainModel strings are NEVER
// rewritten (plan D4) — everything here is read-time.
//
// v2 upgrades kept intact:
//   (a) FOLD-keyed dedupe of recents — 'E5系' and 'E5' are ONE chip (foldKey is the single
//       definition of model equality, review 5A).
//   (b) line-aware ranking from the user's OWN history.
//
// v3 adds the PLAUSIBILITY GATE (user report 2026-07-10: "shinkansen cannot use cr200j
// obviously" — the flat KNOWN_TRAIN_MODELS pad is CN-first, so empty-history 東海道 chips
// began CR400AF…CR200J). Design reviewed by an outside voice; category-level gating was
// rejected (E5 on 東海道 is as wrong as CR200J) in favor of per-line service profiles
// (line-profiles.ts, web-fact-checked). Rules, in precedence order:
//   G4 own-facts override — a recent with an event ON a context line bypasses every gate;
//      the user's own record is never called implausible.
//   G5 unknown free text — a recent that doesn't resolve in the registry is never gated.
//   G1 registry-resolved recents must be plausible in SOME context: in that line's
//      profile, OR (line unprofiled AND conventional AND country matches AND the card
//      is not shinkansen/cn-hsr — those categories' host lines are all profiled, so
//      off-profile they are implausible everywhere).
//   Pads come ONLY from context-line profiles (profile order = pad order). No profiled
//      context ⇒ NO default pads — an honest empty state beats confidently-wrong chips.
//      (This also fail-closes non-card pad tokens like bare 'CR400' whenever a context
//      exists: pads are profile folds, and profiles only hold registry cards.)
//   contexts: [] (known-but-empty — degraded editor rows, search before a route) keeps
//      the gate ON: recents pass ungated (no line info) and there are NO pads.
//   Fail-open — contexts omitted entirely: exact v2 behavior, pinned by the 9A#4
//      baseline test. Gating never applies to what the user TYPES.
//
// Complexity (the v1 no-full-log-sort rule, kept): ONE O(events) pass collects per-fold
// maxima — latest createdAt, the raw spelling at that createdAt, an on-context-line flag —
// then ONLY the (few) distinct folds are sorted. Filtering happens BEFORE the recents
// quota is consumed (an ineligible newer model must not evict an eligible older one).
// Guarded by a benchmark-style test (5k events).

import type { Country, RailLine } from '../contract/rail-package';
import type { RideEvent } from '../contract/types';
import { foldKey, modelByFold, KNOWN_TRAIN_MODELS } from './train-models';
import { lineProfile } from './line-profiles';

/** The marking/editing context of ONE line a trip touches (plausibility-gate input).
 *  RailLine satisfies this structurally — call sites may pass line records directly. */
export interface LineContext {
  lineId: string;
  /** Owning package country — the Country union, so a typo'd caller fails to compile
   *  instead of silently failing the country gate (review finding). */
  country: Country;
  /** N02 事業者種別==1 — the 9 full Shinkansen lines (strict rosters). */
  isHSR: boolean;
}

/** Empty-state copy shared by BOTH chip surfaces (map capture field + diary editor) —
 *  one constant so the strings cannot drift (review finding). The MULTI variant covers
 *  diary rows spanning several lines, where 「この路線」 would claim a single one. */
export const NO_PROFILE_HINT = 'この路線の候補は未収録です。自由入力で記録できます。';
export const NO_PROFILE_HINT_MULTI = 'この旅の路線には候補が未収録です。自由入力で記録できます。';

/** LineContext[] for a trip's lineIds via a line lookup; unresolvable ids drop out.
 *  Shared by the diary editor and the map's search-mode route flow, and unit-testable
 *  (review finding: the derivation was untested UI glue). */
export function lineContexts(
  lineIds: readonly string[],
  lineById: (id: string) => RailLine | undefined,
): LineContext[] {
  const out: LineContext[] = [];
  for (const id of lineIds) {
    const l = lineById(id);
    if (l !== undefined) out.push(l);
  }
  return out;
}

export interface SuggestOptions {
  /** Currently-selected line (line-first mark flow); enables line-aware ranking. */
  lineId?: string;
  /**
   * Resolves an event's segment to its lineId. The integrator passes a memoized geo-index
   * lookup; called at most once per model-carrying event (O(events) calls, O(1) each).
   */
  lineOfSegment?: (segmentId: string) => string | undefined;
  /**
   * Line context(s) for the plausibility gate — ONE for the map's selected line, the
   * candidate routes' lines in search mode, one per trip line in the diary editor
   * (eligible-in-ANY-context). Omit (undefined) ⇒ fail-open v2 (pinned legacy). An
   * EMPTY array means "context known, but no line resolvable" (degraded rows, search
   * before a route exists): recents pass ungated (no country to gate on) and there are
   * NO default pads — the CN-first legacy pad list must never surface once a caller
   * has opted into the gate (outside-voice P1: search mode was fail-opening).
   */
  contexts?: LineContext[];
  /** Chip cap (default 8 — the v1 cap). */
  max?: number;
}

/** v1 rule, preserved: at most 6 recents; the rest of the cap is padded. */
const RECENT_CAP = 6;

/**
 * Suggestion chips for the 車両 capture field: fold-deduped recents (line-matched first,
 * then latest-use desc), gated for plausibility, padded to `max` from the context lines'
 * service profiles (or from KNOWN_TRAIN_MODELS in the no-context fail-open path).
 *
 * Rendering rule: a recent whose fold (or alias) resolves in the registry shows the registry
 * display name ('E5' → 'E5系'); unknown free text stays VERBATIM in its most recent spelling
 * (その他 models are first-class, plan D6 — never normalized away).
 */
export function suggestModels(events: RideEvent[], opts?: SuggestOptions): string[] {
  const max = opts?.max ?? 8;
  if (max <= 0) return [];
  // undefined = legacy fail-open; [] = known-but-empty (gate on, no line info) — see SuggestOptions.
  const contexts = opts?.contexts;
  const lineId = opts?.lineId;
  // On-line flags need the lookup when EITHER the legacy single line or gate contexts exist.
  const lineOf =
    lineId !== undefined || (contexts !== undefined && contexts.length > 0)
      ? opts?.lineOfSegment
      : undefined;
  const contextIds =
    contexts === undefined || contexts.length === 0 ? undefined : new Set(contexts.map((c) => c.lineId));
  const isOnContext = (sid: string): boolean => {
    if (lineOf === undefined) return false;
    const l = lineOf(sid);
    if (l === undefined) return false;
    return contextIds !== undefined ? contextIds.has(l) || l === lineId : l === lineId;
  };

  interface FoldStat {
    latest: string; // max createdAt seen for this fold (ISO strings compare lexicographically)
    raw: string;    // the spelling stored at `latest` — "most recent spelling" for unknowns
    onLine: boolean; // any event of this fold sits on the selected/context line(s)
  }
  // Map iteration order = first-seen order; the stable sort below inherits it for ties,
  // matching the v1 derived's tie behavior exactly.
  const stats = new Map<string, FoldStat>();

  for (const ev of events) {
    if (!ev.trainModel) continue;
    const fold = foldKey(ev.trainModel);
    if (fold === '') continue; // whitespace-only entries carry no signal
    const s = stats.get(fold);
    if (s === undefined) {
      stats.set(fold, {
        latest: ev.createdAt,
        raw: ev.trainModel,
        onLine: isOnContext(ev.segmentId),
      });
    } else {
      if (ev.createdAt > s.latest) {
        s.latest = ev.createdAt;
        s.raw = ev.trainModel;
      }
      if (!s.onLine && isOnContext(ev.segmentId)) s.onLine = true;
    }
  }

  // ── plausibility gate (v3) — computed once per call, O(contexts) ──
  // allowedFolds: union of the context lines' profiles, first context's order first
  // (this union is ALSO the pad list, so order matters). Per-context invariants are
  // precomputed here so cardEligible is pure Set checks (review finding: lineProfile
  // was re-looked-up O(distinctFolds × contexts) inside the ranked loop).
  let allowedFolds: string[] | undefined;
  let anyProfiled = false;
  // Countries with at least one UNPROFILED conventional context line — the only case
  // where the gate falls back to country-level judgment (no roster to consult).
  const unprofiledConvCountries = new Set<Country>();
  // Fold-sets of the PROFILED contexts only (for the through-service pad partition below).
  const profiledSets: Set<string>[] = [];
  if (contexts !== undefined) {
    allowedFolds = [];
    const seen = new Set<string>();
    for (const c of contexts) {
      const p = lineProfile(c.lineId);
      if (p === undefined) {
        if (!c.isHSR) unprofiledConvCountries.add(c.country);
        continue;
      }
      anyProfiled = true;
      profiledSets.push(new Set(p));
      for (const f of p) {
        if (!seen.has(f)) {
          seen.add(f);
          allowedFolds.push(f);
        }
      }
    }
  }
  // ── through-service pad partition (pads ONLY — eligibility above is untouched) ──
  // With ≥2 PROFILED contexts a route spans several lines; a fold present in EVERY profiled
  // profile serves every line of the route, so it is the rider's LIKELIER train and pads
  // first. PRECISION CAVEAT (adversarial finding, accepted): line-granular profiles cannot
  // prove one train runs the route END-TO-END — 50000系 しまかぜ sits on all three 名阪
  // lines via separate services, so it partitions ahead despite no 名阪 through run. That
  // is a RANKING nudge, not a service claim (the UI never says 直通); on the shinkansen
  // corridors the intersection is exact. Stable-partition the union: intersection folds
  // ahead of the rest, each partition keeping its existing relative order. UNPROFILED
  // contexts are SKIPPED — they carry no roster, so counting them would zero out every
  // through fold (explicit policy; allowedSet/cardEligible stay the untouched union).
  // 0/1 profiled ⇒ no partition (nothing to intersect — order is plain union/profile order).
  if (allowedFolds !== undefined && profiledSets.length >= 2) {
    const through: string[] = [];
    const rest: string[] = [];
    for (const f of allowedFolds) {
      (profiledSets.every((set) => set.has(f)) ? through : rest).push(f);
    }
    allowedFolds = [...through, ...rest];
  }
  const allowedSet = allowedFolds === undefined ? undefined : new Set(allowedFolds);

  /** G-rules for a registry-resolved recent (card fold, not raw fold). */
  const cardEligible = (cardFold: string, cardCountry: Country, cardCategory: string): boolean => {
    if (contexts === undefined) return true; // legacy fail-open
    if (contexts.length === 0) return true; // known-but-empty: no line info to gate on
    if (allowedSet !== undefined && allowedSet.has(cardFold)) return true;
    // Unprofiled conventional line of the card's country: pass — EXCEPT shinkansen/cn-hsr
    // cards, whose host lines are ALL profiled (9 isHSR + 4 shared-track hosts + 京沪), so
    // off-profile they are implausible everywhere (outside-voice P2: an N700A recent must
    // not chip on a random metro line). This also subsumes the old `ubiquitous` bypass:
    // the nationwide DMU/commuter families pass here on the lines we lack data for, and
    // on PROFILED lines the curated roster — not a flag — is the truth.
    if (cardCategory === 'shinkansen' || cardCategory === 'cn-hsr') return false;
    return unprofiledConvCountries.has(cardCountry);
  };

  // Rank ONLY the distinct folds: line-matched first, then latest createdAt desc.
  const ranked = [...stats.entries()].sort(([, a], [, b]) => {
    if (a.onLine !== b.onLine) return a.onLine ? -1 : 1;
    return b.latest.localeCompare(a.latest);
  });

  const out: string[] = [];
  const used = new Set<string>(); // folds already represented by an emitted chip
  const recentCap = Math.min(RECENT_CAP, max);
  for (const [fold, s] of ranked) {
    if (out.length >= recentCap) break;
    const card = modelByFold(fold);
    // Gate registry-resolved recents (G1) unless the user logged one on a context line
    // (G4). Unknown free text is never gated (G5). Skipping does NOT consume the quota.
    if (card !== undefined && !s.onLine && !cardEligible(card.fold, card.country, card.category)) continue;
    const display = card?.name ?? s.raw;
    // A registry ALIAS fold ('N700系7000番台') and the card's own fold ('N700') are distinct
    // fold keys resolving to ONE card — dedupe on the display's fold too, or the card would
    // chip twice (and duplicate {#each} keys downstream).
    const displayFold = foldKey(display);
    if (used.has(displayFold)) continue;
    used.add(fold);
    used.add(displayFold);
    out.push(display);
  }

  if (contexts !== undefined) {
    // Pads come ONLY from context profiles; no profiled context (or an empty context
    // set) ⇒ no default pads — the UI shows its honest empty-state line instead of
    // confidently-wrong chips.
    if (anyProfiled && allowedFolds !== undefined) {
      for (const f of allowedFolds) {
        if (out.length >= max) break;
        const display = modelByFold(f)?.name ?? f;
        const displayFold = foldKey(display);
        if (used.has(f) || used.has(displayFold)) continue;
        used.add(f);
        used.add(displayFold);
        out.push(display);
      }
    }
    return out;
  }

  // Fail-open pad path (no contexts): the v1 contract, pinned by the 9A#4 baseline —
  // KNOWN_TRAIN_MODELS in its EXACT declaration order, fold-deduped against recents.
  for (const m of KNOWN_TRAIN_MODELS) {
    if (out.length >= max) break;
    const fold = foldKey(m);
    if (used.has(fold)) continue;
    used.add(fold);
    out.push(m);
  }
  return out;
}
