// Reactive application store. Wraps the Dexie kernel (db) + the pure resolver and
// exposes the small API the UI calls. Everything downstream reads coverage from here;
// no component touches Dexie or the resolver directly.

import { writable, derived, get, type Readable } from 'svelte/store';
import type {
  Country,
  CoverageResult,
  RailGeoPackage,
  RailLine,
  RailSegment,
  RailStation,
  RideEvent,
  RideSource,
} from '../contract/types';
import { coverageWarnings, resolveCoverage, segmentsBetween, type CoverageWarning } from './resolver';
import * as db from './db';
import { STUB_PACKAGES } from '../fixtures/stubPackage';

// ───────────────────────────────── state ────────────────────────────────────

/** Loaded geometry packages. Stub today; swap to the engine artifact via loadPackages(). */
export const packages = writable<RailGeoPackage[]>([]);
/** Mirror of the durable rideEvents log. */
export const events = writable<RideEvent[]>([]);
/** App bootstrap finished (db opened, events + packages loaded). */
export const ready = writable<boolean>(false);
/** True only while the browser reports it is offline (drives the D4 offline overlay). */
export const offline = writable<boolean>(typeof navigator !== 'undefined' && !navigator.onLine);
/**
 * True when the real JP package failed to load and we're running on the stub. The real
 * package is retried on the next `online` event. Surfaced so the UI can warn that coverage
 * is degraded (events pinned to the real package won't resolve against the stub) instead of
 * silently rendering a returning user's rides as 0% / gone.
 */
export const usingFallback = writable<boolean>(false);

// ─────────────────────────────── geo index ──────────────────────────────────

/** One physical-station instance on a particular line (a transfer station has many). */
export interface StationGroupMember {
  lineId: string;
  stationId: string;
}

export interface GeoIndex {
  lineById: Map<string, RailLine>;
  stationById: Map<string, RailStation>;
  segmentById: Map<string, RailSegment>;
  linesByCountry: Map<Country, RailLine[]>;
  stationsByLine: Map<string, RailStation[]>;
  /**
   * The cross-line station group (N02_005g) → every (line, station) instance that shares it.
   * 新宿 on 7 lines collapses to ONE group with 7 members; line inference (search.ts) intersects
   * two stations' groups across the lines they appear on. Stations lacking a stationGroupId fall
   * back to a synthetic per-station group keyed `solo:<stationId>` so inference still works 1:1.
   */
  stationGroupById: Map<string, StationGroupMember[]>;
}

/** The group key for a station: its cross-line stationGroupId, or a synthetic solo key. */
export function groupKeyOf(station: RailStation): string {
  return station.stationGroupId ?? `solo:${station.stationId}`;
}

/**
 * Pure builder for the geo index over a set of packages. The reactive `geo` store derives
 * from this; tests reuse it directly (no Svelte subscription) so there is ONE indexer, no drift.
 */
export function buildGeoIndex(pkgs: RailGeoPackage[]): GeoIndex {
  const lineById = new Map<string, RailLine>();
  const stationById = new Map<string, RailStation>();
  const segmentById = new Map<string, RailSegment>();
  const linesByCountry = new Map<Country, RailLine[]>();
  const stationsByLine = new Map<string, RailStation[]>();
  const stationGroupById = new Map<string, StationGroupMember[]>();
  for (const pkg of pkgs) {
    for (const l of pkg.lines) {
      lineById.set(l.lineId, l);
      (linesByCountry.get(pkg.country) ?? linesByCountry.set(pkg.country, []).get(pkg.country)!).push(l);
    }
    for (const s of pkg.stations) {
      stationById.set(s.stationId, s);
      (stationsByLine.get(s.lineId) ?? stationsByLine.set(s.lineId, []).get(s.lineId)!).push(s);
      const gk = groupKeyOf(s);
      (stationGroupById.get(gk) ?? stationGroupById.set(gk, []).get(gk)!).push({
        lineId: s.lineId,
        stationId: s.stationId,
      });
    }
    for (const seg of pkg.segments) segmentById.set(seg.segmentId, seg);
  }
  for (const list of stationsByLine.values()) list.sort((a, b) => a.seq - b.seq);
  return { lineById, stationById, segmentById, linesByCountry, stationsByLine, stationGroupById };
}

export const geo: Readable<GeoIndex> = derived(packages, ($packages) => buildGeoIndex($packages));

// ─────────────────────────────── coverage ───────────────────────────────────

export interface PackageCoverage {
  pkg: RailGeoPackage;
  result: CoverageResult;
  warnings: CoverageWarning[];
}

/** One CoverageResult per loaded package (JP, then CN, …). The kernel is per-package. */
export const coverages: Readable<PackageCoverage[]> = derived([packages, events], ([$packages, $events]) =>
  $packages.map((pkg) => ({
    pkg,
    result: resolveCoverage($events, pkg),
    warnings: coverageWarnings($events, pkg),
  })),
);

export interface Headline {
  riddenKm: number;
  totalKm: number;
  pctNational: number;
  hsrRiddenKm: number;
  hsrTotalKm: number;
  pctHSR: number;
  prefectures: number;
  byCountry: Partial<Record<Country, CoverageResult>>;
  hasRides: boolean;
}

/** Combined cross-package headline for the stat card / Wrapped. */
export const headline: Readable<Headline> = derived(coverages, ($coverages) => {
  let riddenKm = 0;
  let totalKm = 0;
  let hsrRiddenKm = 0;
  let hsrTotalKm = 0;
  const regions = new Set<string>();
  const byCountry: Partial<Record<Country, CoverageResult>> = {};
  for (const { pkg, result } of $coverages) {
    riddenKm += result.riddenKm;
    totalKm += result.totalKm;
    hsrRiddenKm += result.hsrRiddenKm;
    hsrTotalKm += result.hsrTotalKm;
    byCountry[pkg.country] = result;
    // prefectures are per-country region names; summing the counts double-nothing since
    // JP prefectures and CN provinces are disjoint label spaces.
    for (let i = 0; i < result.prefectures; i++) regions.add(`${pkg.country}:${i}`);
  }
  const pct = (n: number, d: number): number => (d > 0 ? (n / d) * 100 : 0);
  return {
    riddenKm: round2(riddenKm),
    totalKm: round2(totalKm),
    pctNational: pct(riddenKm, totalKm),
    hsrRiddenKm: round2(hsrRiddenKm),
    hsrTotalKm: round2(hsrTotalKm),
    pctHSR: pct(hsrRiddenKm, hsrTotalKm),
    prefectures: regions.size,
    byCountry,
    hasRides: riddenKm > 0,
  };
});

/** Union of lit segmentIds across all packages — the map style expression keys off this. */
export const litSegmentIds: Readable<string[]> = derived(coverages, ($coverages) => {
  const set = new Set<string>();
  for (const { result } of $coverages) for (const id of result.litSegmentIds) set.add(id);
  return [...set].sort();
});

/**
 * Coverage is DEGRADED: we fell back to the stub but the user has saved rides that are pinned
 * to the real package and won't resolve here — so their % would read as 0 / gone. The UI
 * shows a 'network data unavailable, retrying' banner instead of presenting that as truth.
 */
export const dataDegraded: Readable<boolean> = derived(
  [usingFallback, events],
  ([$usingFallback, $events]) => $usingFallback && $events.length > 0,
);

// ───────────────────────────────── actions ──────────────────────────────────

let initialized = false;

/** The built N02 RailGeoPackage, served as a static asset (built by pipeline/build-jp.ts). */
const JP_PACKAGE_URL = `${import.meta.env.BASE_URL}rail/jp-2025.json`;

/**
 * Fetch the real JP network package. Returns `{ ok:false, pkgs: STUB }` on any failure
 * (offline, 404, malformed) so the app always boots with SOMETHING rather than a blank map.
 */
async function fetchJpPackages(): Promise<{ ok: boolean; pkgs: RailGeoPackage[] }> {
  try {
    const res = await fetch(JP_PACKAGE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pkg = (await res.json()) as RailGeoPackage;
    if (!pkg?.lines?.length || !pkg?.segments?.length) throw new Error('empty package');
    return { ok: true, pkgs: [pkg] };
  } catch (err) {
    console.warn(`[store] real JP package unavailable (${String(err)}); using stub`);
    return { ok: false, pkgs: STUB_PACKAGES };
  }
}

let retryBound = false;
let retryInFlight = false;
/**
 * After a failed first load we're on the stub. Re-attempt the real package on the events
 * most correlated with "the network might be healthy now": coming back online, refocusing the
 * tab, or the tab becoming visible. The first failure is often transient (a 404 during deploy,
 * a flaky mobile handoff) and `online` alone misses the case where the browser stayed online —
 * so we also retry on focus/visibility. An in-flight guard prevents overlapping fetches; we
 * unbind on the first success.
 */
function bindFallbackRetry(): void {
  if (retryBound || typeof window === 'undefined') return;
  retryBound = true;
  const events: ('online' | 'focus' | 'visibilitychange')[] = ['online', 'focus', 'visibilitychange'];
  const attempt = async (): Promise<void> => {
    if (retryInFlight) return; // never overlap concurrent re-fetches
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    retryInFlight = true;
    try {
      const { ok, pkgs } = await fetchJpPackages();
      if (ok) {
        packages.set(pkgs);
        usingFallback.set(false);
        for (const ev of events) window.removeEventListener(ev, handler);
      }
    } finally {
      retryInFlight = false;
    }
  };
  const handler = (): void => { void attempt(); };
  for (const ev of events) window.addEventListener(ev, handler);
}

/** Boot the app: open db, load events + the real (or fallback) packages. Idempotent. */
export async function init(): Promise<void> {
  if (initialized) return;
  initialized = true;
  const { ok, pkgs } = await fetchJpPackages();
  packages.set(pkgs);
  usingFallback.set(!ok);
  if (!ok) bindFallbackRetry();
  await refresh();
  if (typeof window !== 'undefined') {
    const sync = (): void => offline.set(!navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
  }
  ready.set(true);
}

/** Swap in explicit RailGeoPackage(s) — used by tests and the importer's package override. */
export function loadPackages(pkgs: RailGeoPackage[]): void {
  packages.set(pkgs);
}

/**
 * Dev-only demo seed: populate a believable ridden set so the local preview shows the
 * flex (glowing lines + a real %) instead of a blank map. Runs ONLY when the log is empty
 * and is clearable via clearAllRides(). Never called in a production build (gated by
 * import.meta.env.DEV at the call site).
 */
export async function seedDemo(): Promise<void> {
  if (get(events).length > 0) return;
  const jp = get(packages).find((p) => p.country === 'JP');
  if (!jp) return;
  const createdAt = new Date().toISOString();
  const ev: RideEvent[] = [];
  const segCount = (lineId: string): number => jp.segments.reduce((n, s) => (s.lineId === lineId ? n + 1 : n), 0);
  // Reference lines by name, but pick the BIGGEST match — line names are not unique across
  // operators (山手線 = JR East Tokyo loop AND 神戸市 Kobe subway), and the demo wants the
  // iconic Tokyo line, which has far more segments than the Kobe namesake.
  const lineByName = (re: RegExp): RailLine | undefined =>
    jp.lines.filter((l) => re.test(l.name)).sort((a, b) => segCount(b.lineId) - segCount(a.lineId))[0];
  const ride = (re: RegExp, keep: (s: RailSegment) => boolean, date: string): void => {
    const line = lineByName(re);
    if (!line) return;
    const tripId = db.newId();
    for (const s of jp.segments.filter((s) => s.lineId === line.lineId && keep(s))) {
      ev.push({
        id: db.newId(), segmentId: s.segmentId, railGeoVersion: jp.version,
        date, source: 'manual', tripId, createdAt,
      });
    }
  };
  ride(/^山手線$/, () => true, '2025-11-03');                        // 山手線 (品川→田端 arc)
  ride(/^東海道新幹線$/, (s) => s.toSeq <= 10, '2025-09-14');         // 東京 → 名古屋あたり
  ride(/^大阪環状線$/, () => true, '2025-10-21');                     // 大阪環状線 full loop
  await addEvents(ev);
}

async function refresh(): Promise<void> {
  events.set(await db.getAllEvents());
}

export interface MarkResult {
  /** Newly-lit segments (0 ⇒ the whole slice was already ridden — show the guard). */
  added: number;
  /** Total segments in the A→B slice. */
  sliceLength: number;
  tripId: string;
  /** The full A→B slice. */
  segmentIds: string[];
  /** ONLY the newly-lit segments — sum km over these so the toast doesn't count re-rides. */
  addedSegmentIds: string[];
}

/**
 * Line-first marking: record riding `from`→`to` on one line as a single trip.
 * Guards a fully-redundant mark (design: "この区間は記録済み"). Throws (via
 * segmentsBetween) if the two stations are not on the same line.
 */
export async function markRide(opts: {
  lineId: string;
  fromStationId: string;
  toStationId: string;
  pkg: RailGeoPackage;
  date?: string;
  trainModel?: string;
  source?: RideSource;
}): Promise<MarkResult> {
  const segmentIds = segmentsBetween(opts.lineId, opts.fromStationId, opts.toStationId, opts.pkg);
  const lit = new Set(resolveCoverage(get(events), opts.pkg).litSegmentIds);
  const added = segmentIds.filter((id) => !lit.has(id));
  if (added.length === 0) {
    return { added: 0, sliceLength: segmentIds.length, tripId: '', segmentIds, addedSegmentIds: [] };
  }
  const tripId = db.newId();
  const createdAt = new Date().toISOString();
  // Persist ONLY the newly-lit segments — never re-stamp already-ridden ones on a
  // partial-overlap re-mark (that bloated the durable log + corrupted per-event stats).
  const newEvents: RideEvent[] = added.map((segmentId) => ({
    id: db.newId(),
    segmentId,
    railGeoVersion: opts.pkg.version,
    date: opts.date,
    trainModel: opts.trainModel,
    source: opts.source ?? 'manual',
    tripId,
    createdAt,
  }));
  await db.putEvents(newEvents);
  await refresh();
  return { added: added.length, sliceLength: segmentIds.length, tripId, segmentIds, addedSegmentIds: added };
}

/** Persist already-built events (importer commit, corridor seed). Merge semantics. */
export async function addEvents(newEvents: RideEvent[]): Promise<void> {
  await db.putEvents(newEvents);
  await refresh();
}

/** Replace the entire log (merge-vs-replace = replace). */
export async function replaceEvents(newEvents: RideEvent[]): Promise<void> {
  await db.replaceAllEvents(newEvents);
  await refresh();
}

export async function removeImportBatch(importBatchId: string): Promise<void> {
  await db.deleteImportBatch(importBatchId);
  await refresh();
}

export async function clearAllRides(): Promise<void> {
  await db.clearAll();
  await refresh();
}

/** Ask the browser to make IndexedDB persistent (T10 durability). Best-effort. */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  return navigator.storage.persist();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
