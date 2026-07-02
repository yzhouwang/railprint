// Reactive application store. Wraps the Dexie kernel (db) + the pure resolver and
// exposes the small API the UI calls. Everything downstream reads coverage from here;
// no component touches Dexie or the resolver directly.

import { writable, derived, get, type Readable } from 'svelte/store';
import type {
  Country,
  CoverageResult,
  RailGeoPackage,
  RailLine,
  RailManifest,
  RailMigrationStep,
  RailSegment,
  RideEvent,
  RideSource,
  RouteCandidate,
} from '../contract/types';
import { MANIFEST_SCHEMA_VERSION } from '../contract/types';
import { coverageWarnings, resolveCoverage, segmentsBetween, type CoverageWarning } from './resolver';
import * as db from './db';
import { JP_PACKAGE } from './fallback-package';
import { canonicalizeTrainModel } from './train-models';

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
// The index itself lives in ./geo-index (framework-free, so pure consumers don't pull in this
// stateful module). store imports buildGeoIndex for the reactive `geo` derived below AND re-exports
// the types + fns so existing importers keep resolving them from './store' unchanged.

import { buildGeoIndex, type GeoIndex } from './geo-index';
export { buildGeoIndex, groupKeyOf } from './geo-index';
export type { GeoIndex, StationGroupMember } from './geo-index';

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
  [usingFallback, events, packages],
  ([$usingFallback, $events, $packages]) => {
    if ($usingFallback && $events.length > 0) return true;
    const loadedSegments = loadedSegmentSetsByNamespace($packages, $usingFallback);
    // A saved ride whose NAMESPACE has no loaded package = a package (e.g. the CN corridor)
    // failed to load, so that ride would silently read as 0 coverage. A missing segment inside a
    // loaded namespace is Phase 4 quarantine data, not a transient package-load failure.
    return $events.some((e) => !loadedSegments.has(namespaceOf(e.segmentId)));
  },
);

// ─────────────────────────────── quarantine ─────────────────────────────────

export interface OrphanRide {
  id: string;
  segmentId: string;
  lineLabel: string;
  date?: string;
  km?: number;
}

export interface OrphanGroup {
  lineId: string;
  lineLabel: string;
  rides: OrphanRide[];
}

function lineIdOfSegment(segmentId: string): string {
  const i = segmentId.indexOf(':');
  return i === -1 ? segmentId : segmentId.slice(0, i);
}

function lineLabelFromLineId(lineId: string): string {
  const parts = lineId.split('-').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : lineId;
}

function loadedSegmentSetsByNamespace(pkgs: RailGeoPackage[], degradedJP: boolean): Map<Country, Set<string>> {
  const out = new Map<Country, Set<string>>();
  for (const pkg of pkgs) {
    // `usingFallback` means JP is represented by the stub, not the user's real namespace package.
    // Treat that namespace as degraded so a transient fetch failure cannot quarantine the log.
    if (pkg.country === 'JP' && degradedJP) continue;
    out.set(pkg.country, new Set(pkg.segments.map((s) => s.segmentId)));
  }
  return out;
}

/** Pending abolished-segment rides, grouped by parsed line label for the quarantine UI. */
export const orphanGroups: Readable<OrphanGroup[]> = derived(
  [packages, events, usingFallback],
  ([$packages, $events, $usingFallback]) => {
    const loadedSegments = loadedSegmentSetsByNamespace($packages, $usingFallback);
    const groups = new Map<string, { lineLabel: string; rides: (OrphanRide & { sortKey: string })[] }>();

    for (const ev of $events) {
      if (ev.quarantine === 'kept') continue;
      const segs = loadedSegments.get(namespaceOf(ev.segmentId));
      if (!segs || segs.has(ev.segmentId)) continue;

      const lineId = lineIdOfSegment(ev.segmentId);
      const lineLabel = lineLabelFromLineId(lineId);
      const group = groups.get(lineId) ?? { lineLabel, rides: [] };
      group.rides.push({
        id: ev.id,
        segmentId: ev.segmentId,
        lineLabel,
        date: ev.date,
        km: ev.km,
        sortKey: ev.date ?? ev.createdAt,
      });
      groups.set(lineId, group);
    }

    return [...groups.entries()]
      .map(([lineId, group]) => ({
        lineId,
        lineLabel: group.lineLabel,
        rides: group.rides
          .sort((a, b) => b.sortKey.localeCompare(a.sortKey) || a.id.localeCompare(b.id))
          .map(({ sortKey: _sortKey, ...ride }) => ride),
      }))
      .sort((a, b) => b.rides.length - a.rides.length || a.lineLabel.localeCompare(b.lineLabel) || a.lineId.localeCompare(b.lineId));
  },
);

export const orphanCount: Readable<number> = derived(orphanGroups, ($groups) =>
  $groups.reduce((sum, g) => sum + g.rides.length, 0),
);

export const closedLineKm: Readable<number> = derived(events, ($events) =>
  round2($events.reduce((sum, ev) => sum + (ev.quarantine === 'kept' ? ev.km ?? 0 : 0), 0)),
);

export const closedLineCount: Readable<number> = derived(events, ($events) =>
  $events.filter((ev) => ev.quarantine === 'kept').length,
);

// ───────────────────────────────── actions ──────────────────────────────────

let initialized = false;

// Packages are served as static assets AND listed in rail/manifest.json (path + version + SHA-256).
const RAIL_PRIMARY = import.meta.env.BASE_URL; // same-origin today
// Optional China-reachable secondary origin (a CDN), tried when the primary fails. Empty until a CDN
// is provisioned — the mechanism ships now; the URL is deploy config (VITE_RAIL_CDN_SECONDARY).
const RAIL_SECONDARY = (import.meta.env.VITE_RAIL_CDN_SECONDARY as string | undefined) || '';
const RAIL_ORIGINS = RAIL_SECONDARY ? [RAIL_PRIMARY, RAIL_SECONDARY] : [RAIL_PRIMARY];

// Cold-start guard: a stalled/flaky network must never hang the loading screen forever. After this
// long we abort the fetch, degrade (JP fallback / CN-miss retry), and let `bindFallbackRetry` recover.
const FETCH_TIMEOUT_MS = 15_000;
// The manifest is tiny (~1.5 KB) and only adds integrity/version over the stable package paths, so it
// gets a SHORTER leash — a hung manifest must never serialize a full FETCH_TIMEOUT_MS ahead of the packages.
const MANIFEST_TIMEOUT_MS = 5_000;

/**
 * fetch + fully consume the body under a SINGLE abort timeout. The timer stays armed across the
 * `consume` callback, so a 200 response with a STALLED BODY aborts too — clearing the timer only
 * after the body is read is what keeps boot from hanging on a half-delivered 8.8 MB package.
 */
async function withTimeout<T>(url: string, timeoutMs: number, consume: (res: Response) => Promise<T>): Promise<T> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl && typeof window !== 'undefined' ? window.setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    return await consume(res);
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

/** Hex SHA-256 of bytes; null in an insecure context (no crypto.subtle → integrity check is skipped). */
async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A manifest sha is usable only as a well-formed 64-char lowercase hex digest (case-normalized). */
function normalizeSha(sha: string | undefined): string | null {
  if (!sha) return null;
  const hex = sha.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/**
 * Fetch + verify one package by its relative path, trying each origin (primary, then the CDN
 * secondary). REJECTS a wrong-country payload AND — when the manifest supplies a sha — a payload
 * whose bytes don't match (a truncated/poisoned artifact silently shifts the km denominator).
 * null on total failure so callers degrade.
 */
async function fetchOne(relPath: string, expectedCountry: Country, expectedSha?: string): Promise<RailGeoPackage | null> {
  const wantSha = normalizeSha(expectedSha);
  if (expectedSha && !wantSha) {
    console.warn(`[store] ${expectedCountry} manifest sha "${expectedSha}" is malformed; loading without integrity check`);
  }
  for (const origin of RAIL_ORIGINS) {
    const url = `${origin}${relPath}`;
    try {
      return await withTimeout(url, FETCH_TIMEOUT_MS, async (res): Promise<RailGeoPackage> => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer(); // body read is COVERED by the same abort timer
        if (wantSha) {
          const got = await sha256Hex(buf);
          // got === null only in an insecure context (no crypto.subtle); HTTPS prod always verifies.
          if (got !== null && got !== wantSha) throw new Error(`sha256 mismatch (${got.slice(0, 8)}… ≠ ${wantSha.slice(0, 8)}…)`);
        }
        const pkg = JSON.parse(new TextDecoder().decode(new Uint8Array(buf))) as RailGeoPackage;
        if (!pkg?.lines?.length || !pkg?.segments?.length) throw new Error('empty package');
        // A swapped/poisoned artifact (the CN url serving a JP package, or vice-versa) must never load
        // under the wrong namespace — that would strand or mis-count rides.
        if (pkg.country !== expectedCountry) throw new Error(`expected ${expectedCountry}, got ${pkg.country}`);
        if (pkg.crs !== 'WGS84') throw new Error(`non-WGS84 crs ${pkg.crs}`); // never accept GCJ-02
        return pkg;
      });
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      const reason = aborted ? `timed out after ${FETCH_TIMEOUT_MS}ms` : String(err);
      console.warn(`[store] ${expectedCountry} package ${url} unavailable (${reason})`); // try the next origin
    }
  }
  return null;
}

/**
 * Load the real network packages, MANIFEST-DRIVEN (rail/manifest.json gives each package's path +
 * SHA-256). If the manifest is unavailable we fall back to the known paths WITHOUT a sha check —
 * integrity is best-effort, availability is not. JP is REQUIRED (its failure → JP-only stub); the
 * CN corridor is ADDITIVE (404 → JP-only + retry). `ok` reflects only the required JP load.
 */
async function fetchPackages(): Promise<{ ok: boolean; complete: boolean; pkgs: RailGeoPackage[] }> {
  let manifest: Manifest | null = null;
  try {
    manifest = await withTimeout(`${RAIL_PRIMARY}rail/manifest.json`, MANIFEST_TIMEOUT_MS, async (res) => {
      if (!res.ok) return null;
      const m = (await res.json()) as Manifest;
      if (!manifestSchemaSupported(m)) {
        console.warn(`[store] manifest schemaVersion ${m.schemaVersion} > supported ${MANIFEST_SCHEMA_VERSION}; ignoring (last-good paths)`);
        return null;
      }
      return m;
    });
  } catch { /* no manifest → path fallback below (no sha) */ }
  const jpEntry = manifest?.packages?.JP;
  const cnEntry = manifest?.packages?.CN;
  // A loaded-but-incomplete manifest (entry/sha missing) is a build smell — warn, but still load
  // best-effort from the default path. The manifest is a same-origin trusted root; bricking the app
  // on a manifest typo is worse than loading unverified same-origin bytes (the sha guards transfer
  // corruption, not a same-origin attacker who could rewrite both files anyway).
  if (manifest && (!jpEntry?.sha256 || !cnEntry?.sha256)) {
    console.warn('[store] manifest present but a package sha is missing; loading default path without integrity check');
  }
  const [jp, cn] = await Promise.all([
    fetchOne(jpEntry?.path ?? 'rail/jp-2025.json', 'JP', jpEntry?.sha256),
    fetchOne(cnEntry?.path ?? 'rail/cn-jinghu-2025.json', 'CN', cnEntry?.sha256),
  ]);
  if (!jp) {
    // JP-ONLY fallback — never seed a fake CN stub whose ids mismatch the real package.
    console.warn('[store] real JP package unavailable; using JP-only stub (no CN fallback)');
    return { ok: false, complete: false, pkgs: [JP_PACKAGE] };
  }
  if (!cn) console.warn('[store] CN corridor unavailable; booting JP-only (will retry on reconnect)');
  // complete only when EVERY package loaded — a CN miss keeps the retry bound so a returning user's
  // saved China rides aren't silently stranded as 0-coverage.
  return { ok: true, complete: !!cn, pkgs: cn ? [jp, cn] : [jp] };
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
      const { ok, complete, pkgs } = await fetchPackages();
      if (ok) {
        packages.set(pkgs); // swap in whatever loaded (JP, or JP+CN); usingFallback clears off the stub
        usingFallback.set(false);
        void migrateEventsIfNeeded(pkgs); // the real (versioned) package just arrived — migrate now,
        // since init()'s one migration pass ran against the stub and saw nothing to do
      }
      // Only stop retrying once EVERY package is present — a JP-ok/CN-fail round keeps listening.
      if (complete) for (const ev of events) window.removeEventListener(ev, handler);
    } finally {
      retryInFlight = false;
    }
  };
  const handler = (): void => { void attempt(); };
  for (const ev of events) window.addEventListener(ev, handler);
}

// ── N→N+1 geometry migration ────────────────────────────────────────────────────────────────
// When a package version bumps and its segmentIds changed (the Phase-0 scheme change is the first
// such), a returning user's events still pin the OLD ids. The build ships an old→new map per
// version step; here we replay the chain to re-point events IN PLACE (id stays stable, coverage
// keys on segmentId). NON-BLOCKING: runs after `ready`, off the first-paint path; a map that can't
// load (offline / 404) leaves events untouched (the degraded banner covers it) and retries online.
const MANIFEST_URL = `${import.meta.env.BASE_URL}rail/manifest.json`;

// Manifest + migration shapes are the SHARED railnet contract (rail-package.ts) — one definition,
// so a producer/consumer skew can't silently mis-read a returning user's coverage. (Before the split
// these were hand-duplicated here AND in the build, with the schema version hardcoded in both.)
type MigrationStep = RailMigrationStep;
type Manifest = RailManifest;

/** Reject a manifest whose schema is NEWER than this consumer understands — fail-safe to the last-good
 *  paths rather than mis-reading a future producer's shape. An older/absent schemaVersion still loads. */
function manifestSchemaSupported(m: Manifest): boolean {
  return m.schemaVersion === undefined || m.schemaVersion <= MANIFEST_SCHEMA_VERSION;
}

/** Ordered migration steps WITHIN one package that carry `fromVersion` up to its current version. */
function chainWithin(
  pkg: { version: string; migrations: MigrationStep[] },
  fromVersion: string,
): MigrationStep[] | null {
  if (pkg.version === fromVersion) return []; // already current
  const byFrom = new Map(pkg.migrations.map((m) => [m.fromVersion, m]));
  const steps: MigrationStep[] = [];
  const seen = new Set<string>();
  let cur = fromVersion;
  while (cur !== pkg.version) {
    if (seen.has(cur) || steps.length > pkg.migrations.length) return null; // cycle / runaway → refuse
    seen.add(cur);
    const step = byFrom.get(cur);
    if (!step || step.toVersion === cur) break; // broken chain / self-loop
    steps.push(step);
    cur = step.toVersion;
  }
  return cur === pkg.version && steps.length ? steps : null;
}

/** Namespace from the STABLE country prefix (jp-… / cn-…), which a scheme migration never changes. */
function namespaceOf(segmentId: string): Country {
  return segmentId.startsWith('cn-') ? 'CN' : 'JP';
}

function withKmSnapshots(rows: RideEvent[]): RideEvent[] {
  if (rows.length === 0) return rows;
  const segById = get(geo).segmentById;
  let changed = false;
  const snapped = rows.map((ev) => {
    if (ev.km !== undefined) return ev;
    const seg = segById.get(ev.segmentId);
    if (!seg) return ev;
    changed = true;
    return { ...ev, km: seg.km };
  });
  return changed ? snapped : rows;
}

let migrationRetryBound = false;
function bindMigrationRetry(pkgs: RailGeoPackage[]): void {
  if (migrationRetryBound || typeof window === 'undefined') return;
  migrationRetryBound = true;
  const triggers = ['online', 'focus', 'visibilitychange'];
  const handler = (): void => {
    migrationRetryBound = false;
    for (const t of triggers) window.removeEventListener(t, handler);
    void migrateEventsIfNeeded(pkgs);
  };
  for (const t of triggers) window.addEventListener(t, handler);
}

async function migrateEventsIfNeeded(pkgs: RailGeoPackage[]): Promise<void> {
  if (typeof fetch === 'undefined') return;
  const evs = get(events);
  if (evs.length === 0) return;
  // PER-NAMESPACE current version — JP and CN bump independently, so a global version set would let
  // CN's version (e.g. 2025.1.0) mask a genuinely-stale JP event also pinned to 2025.1.0.
  const versionByNs = new Map(pkgs.map((p) => [p.country, p.version]));
  const stale = evs.filter((e) => {
    const v = versionByNs.get(namespaceOf(e.segmentId));
    return v !== undefined && e.railGeoVersion !== v;
  });
  if (stale.length === 0) return;

  let manifest: Manifest;
  try {
    const res = await fetch(MANIFEST_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = (await res.json()) as Manifest;
    if (!manifestSchemaSupported(parsed)) throw new Error(`manifest schemaVersion ${parsed.schemaVersion} > supported ${MANIFEST_SCHEMA_VERSION}`);
    manifest = parsed;
  } catch (err) {
    console.warn(`[store] migration manifest unavailable (${String(err)}); retrying on reconnect`);
    bindMigrationRetry(pkgs);
    return;
  }

  const mapCache = new Map<string, Record<string, string> | null>();
  const segmentIdMap = async (path: string): Promise<Record<string, string> | null> => {
    if (mapCache.has(path)) return mapCache.get(path)!;
    let map: Record<string, string> | null = null;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
      if (res.ok) map = ((await res.json()) as { segmentIdMap: Record<string, string> }).segmentIdMap ?? {};
    } catch {
      map = null;
    }
    mapCache.set(path, map);
    return map;
  };

  const migrated: RideEvent[] = [];
  let deferred = false; // a map didn't load → retry online, don't lose the migration
  for (const ev of stale) {
    const pkgEntry = manifest.packages[namespaceOf(ev.segmentId)];
    if (!pkgEntry) continue; // no manifest entry for this namespace → leave (surfaces via warnings)
    const chain = chainWithin(pkgEntry, ev.railGeoVersion);
    if (!chain || chain.length === 0) continue;
    let segId = ev.segmentId;
    let version = ev.railGeoVersion;
    let broke = false;
    for (const step of chain) {
      const map = await segmentIdMap(step.path);
      if (map === null) { deferred = true; broke = true; break; } // transient — keep, retry
      const next = map[segId];
      if (next === undefined) { broke = true; break; } // unmapped (abolished segment) → orphan, leave as-is
      segId = next;
      version = step.toVersion;
    }
    if (broke) continue;
    if (segId !== ev.segmentId || version !== ev.railGeoVersion) {
      migrated.push({
        ...ev,
        segmentId: segId,
        originalSegmentId: ev.originalSegmentId ?? ev.segmentId, // set ONCE — first-ever id
        railGeoVersion: version,
      });
    }
  }

  if (migrated.length > 0) {
    await db.putEvents(migrated); // bulkPut overwrites in place by the stable id; idempotent re-run is a no-op
    await refresh(); // coverage self-heals on the new segmentIds
  }
  if (deferred) bindMigrationRetry(pkgs);
}

/** Boot the app: open db, load events + the real (or fallback) packages. Idempotent. */
export async function init(): Promise<void> {
  if (initialized) return;
  initialized = true;
  // Open the durable store + load saved rides FIRST, before the slow, network-bound package fetch.
  // refresh() is the first Dexie op, so it creates the object stores; doing it up front means the DB
  // is ready independent of fetch speed. Otherwise a slow environment (CI's cold 8.8 MB fetch) creates
  // the stores only AFTER the fetch, and anything that opens the DB in that window — e.g. an e2e seed
  // that waits only for the DB name to appear — finds no rideEvents store. Also just better: coverage
  // resolves the instant packages arrive, and saved rides are never gated on the network.
  await refresh();
  const { ok, complete, pkgs } = await fetchPackages();
  packages.set(pkgs);
  usingFallback.set(!ok);
  if (!complete) bindFallbackRetry(); // retry until EVERY package is in (JP stub OR a missed CN corridor)
  if (typeof window !== 'undefined') {
    const sync = (): void => offline.set(!navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
  }
  ready.set(true);                  // render immediately (non-blocking)
  void migrateEventsIfNeeded(pkgs); // re-point any version-stale events off the first-paint path
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
  /** Event rows written for this trip. Coverage may already have included some/all segments. */
  added: number;
  /** Total segments in the A→B slice. */
  sliceLength: number;
  /** Slice segments that were already lit before this mark. */
  alreadyCovered: number;
  tripId: string;
  /** The full A→B slice. */
  segmentIds: string[];
  /** Segment ids for rows written by this call. */
  addedSegmentIds: string[];
}

/**
 * Line-first marking: record riding `from`→`to` on one line as a single trip.
 * Repeat rides append a new trip; coverage is derived and deduped downstream.
 * Throws (via segmentsBetween) if the two stations are not on the same line.
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
  // Read the already-derived lit set (same as markRoute) instead of recomputing a full
  // per-package coverage pass on every mark — segmentIds belong to opts.pkg, so membership holds.
  const lit = new Set(get(litSegmentIds));
  const alreadyCovered = segmentIds.filter((id) => lit.has(id)).length;
  const tripId = db.newId();
  const createdAt = new Date().toISOString();
  const trainModel = opts.trainModel === undefined ? undefined : canonicalizeTrainModel(opts.trainModel) || undefined;
  const segById = new Map(opts.pkg.segments.map((seg) => [seg.segmentId, seg]));
  const candidates: RideEvent[] = segmentIds.map((segmentId) => ({
    id: `${tripId}:${segmentId}`,
    segmentId,
    railGeoVersion: opts.pkg.version,
    km: segById.get(segmentId)?.km,
    date: opts.date,
    trainModel,
    source: opts.source ?? 'manual',
    tripId,
    createdAt,
  }));
  const persisted = await db.addRideSegments(candidates);
  await refresh();
  return {
    added: persisted.length,
    sliceLength: segmentIds.length,
    alreadyCovered,
    tripId,
    segmentIds,
    addedSegmentIds: persisted.map((e) => e.segmentId),
  };
}

export interface MarkRouteResult {
  /** Event rows written for this trip. Coverage may already have included some/all segments. */
  added: number;
  tripId: string;
  /** Route distance, from the chosen candidate. */
  totalKm: number;
  /** Every leg of the route. */
  segmentIds: string[];
  /** Route legs that were already lit before this mark. */
  alreadyCovered: number;
}

/**
 * Mark a whole cross-line route (the route-picker's chosen candidate) as ONE trip.
 * Repeat rides append a new trip; coverage is derived and deduped downstream.
 */
export async function markRoute(
  route: RouteCandidate,
  opts?: { date?: string; trainModel?: string; source?: RideSource },
): Promise<MarkRouteResult> {
  const lit = new Set(get(litSegmentIds));
  const alreadyCovered = route.segmentIds.filter((id) => lit.has(id)).length;
  const tripId = db.newId();
  const createdAt = new Date().toISOString();
  const trainModel = opts?.trainModel === undefined ? undefined : canonicalizeTrainModel(opts.trainModel) || undefined;
  const res = await db.markRouteSegments(route.segmentIds, {
    railGeoVersion: route.railGeoVersion,
    date: opts?.date,
    trainModel,
    source: opts?.source ?? 'manual',
    tripId,
    createdAt,
  });
  await refresh();
  return { added: res.added, tripId, totalKm: route.totalKm, segmentIds: route.segmentIds, alreadyCovered };
}

/** Persist already-built events (importer commit, corridor seed). Merge semantics. */
export async function addEvents(newEvents: RideEvent[]): Promise<void> {
  await db.putEvents(withKmSnapshots(newEvents));
  await refresh();
}

/** Replace the entire log (merge-vs-replace = replace). */
export async function replaceEvents(newEvents: RideEvent[]): Promise<void> {
  await db.replaceAllEvents(withKmSnapshots(newEvents));
  await refresh();
}

export async function keepAsOrphan(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const wanted = new Set(ids);
  const updates = get(events)
    .filter((ev) => wanted.has(ev.id))
    .map((ev) => (ev.quarantine === 'kept' ? ev : { ...ev, quarantine: 'kept' as const }));
  if (updates.length === 0) return;
  await db.putEvents(updates);
  await refresh();
}

export async function removeImportBatch(importBatchId: string): Promise<void> {
  await db.deleteImportBatch(importBatchId);
  await refresh();
}

/**
 * Delete exactly these event ids — the precise undo for an import. Deleting by id (not by the
 * content-derived importBatchId) means undo only ever removes the rows THIS commit wrote, never an
 * older import that happened to hash to the same batch id.
 */
export async function removeEvents(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.deleteEvents(ids);
  await refresh();
}

/** Delete every event of one trip. The append model's undo primitive — the toast-undo UI that
 *  will call it is a deferred fast-follow; for now it backs tests + a future diary edit/delete. */
export async function removeTrip(tripId: string): Promise<void> {
  await db.deleteTrip(tripId);
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
