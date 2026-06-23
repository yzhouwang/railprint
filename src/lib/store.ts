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

// ─────────────────────────────── geo index ──────────────────────────────────

export interface GeoIndex {
  lineById: Map<string, RailLine>;
  stationById: Map<string, RailStation>;
  segmentById: Map<string, RailSegment>;
  linesByCountry: Map<Country, RailLine[]>;
  stationsByLine: Map<string, RailStation[]>;
}

export const geo: Readable<GeoIndex> = derived(packages, ($packages) => {
  const lineById = new Map<string, RailLine>();
  const stationById = new Map<string, RailStation>();
  const segmentById = new Map<string, RailSegment>();
  const linesByCountry = new Map<Country, RailLine[]>();
  const stationsByLine = new Map<string, RailStation[]>();
  for (const pkg of $packages) {
    for (const l of pkg.lines) {
      lineById.set(l.lineId, l);
      (linesByCountry.get(pkg.country) ?? linesByCountry.set(pkg.country, []).get(pkg.country)!).push(l);
    }
    for (const s of pkg.stations) {
      stationById.set(s.stationId, s);
      (stationsByLine.get(s.lineId) ?? stationsByLine.set(s.lineId, []).get(s.lineId)!).push(s);
    }
    for (const seg of pkg.segments) segmentById.set(seg.segmentId, seg);
  }
  for (const list of stationsByLine.values()) list.sort((a, b) => a.seq - b.seq);
  return { lineById, stationById, segmentById, linesByCountry, stationsByLine };
});

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

// ───────────────────────────────── actions ──────────────────────────────────

let initialized = false;

/** Boot the app: open db, load events + (stub) packages. Idempotent. */
export async function init(): Promise<void> {
  if (initialized) return;
  initialized = true;
  packages.set(STUB_PACKAGES);
  await refresh();
  if (typeof window !== 'undefined') {
    const sync = (): void => offline.set(!navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
  }
  ready.set(true);
}

/** Swap the stub for the engine's real RailGeoPackage(s) once T2/T3/T7 are green. */
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
  const jp = STUB_PACKAGES.find((p) => p.country === 'JP');
  if (!jp) return;
  const createdAt = new Date().toISOString();
  const ev: RideEvent[] = [];
  const ride = (lineId: string, keep: (s: RailSegment) => boolean, date: string): void => {
    const tripId = db.newId();
    for (const s of jp.segments.filter((s) => s.lineId === lineId && keep(s))) {
      ev.push({
        id: db.newId(), segmentId: s.segmentId, railGeoVersion: jp.version,
        date, source: 'manual', tripId, createdAt,
      });
    }
  };
  ride('jr-yamanote', () => true, '2025-11-03');                      // full 山手線 loop
  ride('jr-tokaido-shinkansen', (s) => s.toSeq <= 12, '2025-09-14');  // 東京 → 名古屋
  ride('tokyu-toyoko', () => true, '2025-10-21');                     // 渋谷 → 横浜
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
