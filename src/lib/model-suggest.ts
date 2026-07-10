// 車両 suggestion chips v2 (v0.13 vehicle-dex, plan D8 / review 5A) — PURE lib.
// MapView owns the wiring (passes $events + the selected line + a memoized geo-index
// segment→line lookup); this module only ranks. Stored trainModel strings are NEVER
// rewritten (plan D4) — everything here is read-time.
//
// Replaces the v1 `modelSuggestions` $derived (MapView.svelte:129–153; its exact behavior
// is regression-pinned in model-suggest.test.ts per review 9A#4) with two upgrades:
//   (a) FOLD-keyed dedupe of recents — 'E5系' (import spelling) and 'E5' (manual spelling)
//       are ONE chip, not two (kills the double-chip bug). Equality routes through
//       foldKey(), the single definition of model equality (review 5A).
//   (b) line-aware ranking from the user's OWN history — a model previously logged on the
//       currently-selected line outranks a merely-newer model logged elsewhere. There is
//       deliberately NO curated line→model dataset (zero licensing surface, plan D8): the
//       only signal is the caller-supplied segment→line lookup over the user's own events.
//
// Complexity (the MapView.svelte:129–132 rule, kept): ONE O(events) pass collects per-fold
// maxima — latest createdAt, the raw spelling at that createdAt, an on-selected-line flag —
// then ONLY the (few) distinct folds are sorted. Never a sort over the whole event log just
// to surface ≤8 chips (the log is id-ordered, not date-ordered, so the maxima need the pass
// anyway). Guarded by a benchmark-style test (5k events).

import type { RideEvent } from '../contract/types';
import { foldKey, modelByFold, KNOWN_TRAIN_MODELS } from './train-models';

export interface SuggestOptions {
  /** Currently-selected line (line-first mark flow); enables line-aware ranking. */
  lineId?: string;
  /**
   * Resolves an event's segment to its lineId. The integrator passes a memoized geo-index
   * lookup; called at most once per model-carrying event (O(events) calls, O(1) each).
   */
  lineOfSegment?: (segmentId: string) => string | undefined;
  /** Chip cap (default 8 — the v1 cap). */
  max?: number;
}

/** v1 rule, preserved: at most 6 recents; the rest of the cap is padded from the known list. */
const RECENT_CAP = 6;

/**
 * Suggestion chips for the 車両 capture field: fold-deduped recents (line-matched first,
 * then latest-use desc), padded to `max` with KNOWN_TRAIN_MODELS in their exact array order.
 *
 * Rendering rule: a recent whose fold (or alias) resolves in the registry shows the registry
 * display name ('E5' → 'E5系' — so the chip, the D15 canonical preview, and the 図鑑 card all
 * agree on one spelling); unknown free text stays VERBATIM in its most recent spelling
 * (その他 models are first-class, plan D6 — never normalized away). Pad entries are the
 * KNOWN_TRAIN_MODELS strings verbatim (v1 behavior, pinned by the 9A#4 baseline test).
 */
export function suggestModels(events: RideEvent[], opts?: SuggestOptions): string[] {
  const max = opts?.max ?? 8;
  if (max <= 0) return [];
  const lineId = opts?.lineId;
  // No selected line ⇒ never call the lookup (pure-recency fallback, and no wasted work).
  const lineOf = lineId !== undefined ? opts?.lineOfSegment : undefined;

  interface FoldStat {
    latest: string; // max createdAt seen for this fold (ISO strings compare lexicographically)
    raw: string;    // the spelling stored at `latest` — "most recent spelling" for unknowns
    onLine: boolean; // any event of this fold sits on the selected line
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
        onLine: lineOf !== undefined && lineOf(ev.segmentId) === lineId,
      });
    } else {
      if (ev.createdAt > s.latest) {
        s.latest = ev.createdAt;
        s.raw = ev.trainModel;
      }
      if (!s.onLine && lineOf !== undefined && lineOf(ev.segmentId) === lineId) s.onLine = true;
    }
  }

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
    const display = modelByFold(fold)?.name ?? s.raw;
    // A registry ALIAS fold ('N700系7000番台') and the card's own fold ('N700') are distinct
    // fold keys resolving to ONE card — dedupe on the display's fold too, or the card would
    // chip twice (and duplicate {#each} keys downstream).
    const displayFold = foldKey(display);
    if (used.has(displayFold)) continue;
    used.add(fold);
    used.add(displayFold);
    out.push(display);
  }
  // Pad with the known list in its EXACT declaration order (v1 contract), skipping any model
  // already represented — by fold, not by exact string, so a recent 'E5系' suppresses pad 'E5'.
  for (const m of KNOWN_TRAIN_MODELS) {
    if (out.length >= max) break;
    const fold = foldKey(m);
    if (used.has(fold)) continue;
    used.add(fold);
    out.push(m);
  }
  return out;
}
