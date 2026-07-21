// Pure marking logic — the search-mode "type A, type B, infer the route" DECISIONS, extracted from
// MapView so they're unit-testable without a map or DOM. The component still owns all $state, the
// template bindings, and every side effect (toasts, store reads, markRoute, pulse, exiting mark
// mode); this module is framework-free and only decides.
//
// Two out-of-order guards exist in the flow and are DISTINCT — don't conflate them:
//   • SearchSeq guards the async station-NAME resolve (resolveInto): resolveQuery is async (lazy
//     wanakana), so a stale keystroke's resolve is dropped by a monotonic sequence. Unit-tested here.
//   • the ROUTE search guard (tryInfer) is object-identity on the pinned endpoints across a
//     requestAnimationFrame yield — that stays in the component and is covered by the route-picker
//     e2e spec, not a unit test.

import type { RailGeoPackage, RouteCandidate } from '../contract/types';
import { findRoutes } from './route';
import { groupKeyForHit, preferPickedLine, type StationHit } from './search';

/**
 * Latest-wins guard for the async station-name resolve. Call `next()` before the await and keep the
 * returned token; after the await, `isCurrent(token)` is false iff a newer keystroke has since
 * bumped the counter, so the stale resolve is dropped.
 */
export class SearchSeq {
  private latest = 0;
  next(): number {
    return ++this.latest;
  }
  isCurrent(seq: number): boolean {
    return seq === this.latest;
  }
}

/** The two pinned endpoints are the same physical station — there is no route to find. */
export function sameStation(a: StationHit, b: StationHit): boolean {
  return a.station.stationId === b.station.stationId;
}

/** The classification of the route(s) between two pinned endpoints. */
export type RouteOutcome =
  | { kind: 'no-route' }
  | { kind: 'single'; route: RouteCandidate }
  | { kind: 'multi'; routes: RouteCandidate[] };

/**
 * Find the cross-line route(s) A→B within a package and classify them. Routes are re-ordered so one
 * on a line the user actually picked comes first (never float a parallel Shinkansen above the local
 * line they rode, which would tempt a one-tap phantom HSR mark). Zero routes → no-route; exactly
 * one → kind 'single' (callers treat it as pre-selected); two or more → kind 'multi' (callers
 * offer a choice). How selection/confirmation renders is the caller's concern.
 */
export function classifyRoutes(pkg: RailGeoPackage, a: StationHit, b: StationHit): RouteOutcome {
  const routes = preferPickedLine(
    findRoutes(pkg, groupKeyForHit(a), groupKeyForHit(b)),
    new Set([a.line.lineId, b.line.lineId]),
  );
  if (routes.length === 0) return { kind: 'no-route' };
  if (routes.length === 1) return { kind: 'single', route: routes[0] };
  return { kind: 'multi', routes };
}
