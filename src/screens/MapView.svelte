<script lang="ts">
  // T6 — the real, reusable MapLibre map. Renders the whole rail network (dim) with the
  // ridden segments lit via a SINGLE data-driven style expression keyed off litSegmentIds
  // (DESIGN decision: no per-feature setFeatureState). Updates with setPaintProperty when
  // the lit set changes. D5 "map floods green" wave on a big grow; brief pulse on a mark.
  //
  // App renders this full-bleed on desktop; MapScreen embeds it on mobile. It owns the
  // line-first marking interaction (DESIGN issue 5) so the flow is identical in both
  // compositions: FAB → markMode → line picker → tap station A → tap station B → markRide.
  //
  // maplibre touches the DOM/WebGL, so it is dynamically imported inside onMount and NEVER
  // at module eval — importing this file in a non-browser context is side-effect free.

  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { packages, litSegmentIds, geo, events, markRide, markRoute } from '../lib/store';
  import { findRoutes } from '../lib/route';
  import Pill from '../components/Pill.svelte';
  import { KNOWN_TRAIN_MODELS } from '../lib/train-models';
  import { markMode, toast } from '../lib/ui';
  import { tokens } from '../design/tokens';
  import type { RailLine, RouteCandidate } from '../contract/types';
  import {
    buildBaseStyle,
    networkBounds,
    riddenBounds,
    litStationIds,
    lineOpacityExpression,
    lineWidthExpression,
    glowWidthExpression,
    glowOpacityExpression,
    stationColorExpression,
    stationRadiusExpression,
    selectedLineSegmentIds,
    selectedLineStationIds,
    inFilter,
    lodFilter,
    DEFAULT_LINE_COLOR,
    SEGMENTS_LAYER,
    SEGMENTS_GLOW_LAYER,
    STATIONS_LAYER,
    SELECTION_CASING_LAYER,
    HIGHLIGHT_STATION_LAYER,
  } from '../lib/map/style';
  import {
    segmentMidpoints,
    buildFloodPlan,
    diffNewlyLit,
    prefersReducedMotion,
    runFlood,
    type SegPoint,
  } from '../lib/map/flood';
  import {
    buildSearchIndex,
    resolveQuery,
    groupKeyForHit,
    preferPickedLine,
    bilingualLabel,
    type StationHit,
  } from '../lib/search';
  import { buildPopupModel, popupHtml } from '../lib/map/popup';
  import { companyFor } from '../lib/company';

  // Loaded lazily so the module-eval is browser-free.
  type MapLib = typeof import('maplibre-gl');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let map: any = null;
  let mapLib: MapLib | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let popup: any = null; // C5 reusable bilingual hover/selection popup

  let container: HTMLDivElement;
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let styleLoaded = false;

  // ── marking state (line-first: pick line → tap A → tap B) ───────────────────
  let selectedLine = $state<RailLine | null>(null);
  let stationA = $state<string | null>(null);
  let stationAName = $state<string | null>(null);
  let busy = $state(false);
  // T2 — the optional train model for the next mark (e.g. N700S, CR400AF). Read by both
  // mark paths; never blocks a mark. Cleared after a successful record.
  let markTrainModel = $state('');

  // ── station-first search state (C4): an alternative entry to tapping ─────────
  // entryMode: 'tap' (pick a line then tap A,B) or 'search' (type A, type B, infer the line).
  let entryMode = $state<'tap' | 'search'>('tap');
  let queryA = $state('');
  let queryB = $state('');
  let hitsA = $state<StationHit[]>([]); // disambiguation list for A (>1 ⇒ show picker)
  let hitsB = $state<StationHit[]>([]);
  let pickedA = $state<StationHit | null>(null);
  let pickedB = $state<StationHit | null>(null);
  let routeChoices = $state<RouteCandidate[]>([]); // cross-line route picker (search-mode)
  let noRoute = $state(false); // the two stations have no rail path between them
  let searching = $state(false); // route-finding in flight (paints "探索中" before the sync call)
  let searchSeq = 0; // guards out-of-order async resolves (latest query wins)

  // The bilingual search index — rebuilt only when the geo index changes (i.e. packages swap).
  const searchIndex = $derived(buildSearchIndex($geo));

  // Use a manual subscription for markMode so we can react in effects + reset on exit.
  let markActive = $state(false);
  $effect(() => {
    const unsub = markMode.subscribe((v) => {
      markActive = v;
      if (!v) resetMarking();
    });
    return unsub;
  });

  function resetMarking(): void {
    selectedLine = null;
    stationA = null;
    stationAName = null;
    markTrainModel = '';
    resetSearch();
  }

  // Recent-then-known train models for the optional capture chips. The user's most-recently
  // tagged models first, padded with the canonical known models. A single O(events) pass tracks
  // each model's latest timestamp, then only the (few) DISTINCT models are ranked — never a sort
  // over the whole event log just to surface a handful of chips ($events is id-ordered, not by date).
  const modelSuggestions = $derived.by(() => {
    const latest = new Map<string, string>();
    for (const e of $events) {
      if (!e.trainModel) continue;
      const prev = latest.get(e.trainModel);
      if (prev === undefined || e.createdAt > prev) latest.set(e.trainModel, e.createdAt);
    }
    const out = [...latest.entries()]
      .sort((a, b) => b[1].localeCompare(a[1]))
      .slice(0, 6)
      .map(([m]) => m);
    const seen = new Set(out);
    for (const m of KNOWN_TRAIN_MODELS) {
      if (out.length >= 8) break;
      if (!seen.has(m)) {
        seen.add(m);
        out.push(m);
      }
    }
    return out;
  });

  function resetSearch(): void {
    entryMode = 'tap';
    queryA = '';
    queryB = '';
    hitsA = [];
    hitsB = [];
    pickedA = null;
    pickedB = null;
    routeChoices = [];
    noRoute = false;
    searching = false;
  }

  // Lines available to pick, grouped by country (geo.linesByCountry).
  const lineGroups = $derived.by(() => {
    const idx = $geo;
    const groups: { country: string; lines: RailLine[] }[] = [];
    for (const [country, lines] of idx.linesByCountry) {
      groups.push({ country, lines: [...lines].sort((a, b) => a.name.localeCompare(b.name)) });
    }
    return groups;
  });

  // segment midpoints for the flood sweep — recomputed only when packages change.
  let midpoints = new Map<string, SegPoint>();
  let prevLit: string[] = [];
  let cancelFlood: (() => void) | null = null;

  onMount(() => {
    let disposed = false;
    (async () => {
      try {
        mapLib = await import('maplibre-gl');
        await import('maplibre-gl/dist/maplibre-gl.css');
        if (disposed) return;
        const pkgs = get(packages);
        midpoints = segmentMidpoints(pkgs[0] ?? { segments: [], stations: [] } as never);
        // merge midpoints across all packages
        for (const p of pkgs) for (const [k, v] of segmentMidpoints(p)) midpoints.set(k, v);

        const initialLit = get(litSegmentIds);
        prevLit = initialLit;
        const style = buildBaseStyle({ packages: pkgs, litSegmentIds: initialLit });

        map = new mapLib.Map({
          container,
          style: style as never,
          // Compact ⓘ control — aggregates the OSM basemap + N02 rail CC BY credits (both
          // legally required to be visible). Collapsed by default so it stays out of the way.
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          // JP focus default; fitBounds overrides once style is ready.
          center: [138, 37],
          zoom: 4,
          // self-contained: no remote glyphs/tiles requested.
          fadeDuration: prefersReducedMotion() ? 0 : 200,
        });
        map.touchZoomRotate?.disableRotation?.();
        exposeE2EHandle();

        map.on('load', () => {
          if (disposed) return;
          styleLoaded = true;
          fitToNetwork();
          wireStationClicks();
          void surfaceLogoCredits();
          status = 'ready';
        });
        map.on('error', (e: unknown) => {
          // GL/style errors after load shouldn't blank the map; only fail before ready.
          if (status !== 'ready') {
            console.error('[MapView] maplibre error:', (e as { error?: Error })?.error?.message ?? (e as { error?: unknown })?.error ?? e);
            status = 'error';
          }
        });
      } catch (err) {
        console.error('[MapView] failed to init', err);
        if (!disposed) status = 'error';
      }
    })();

    return () => {
      disposed = true;
      cancelFlood?.();
      popup?.remove?.();
      popup = null;
      map?.remove?.();
      map = null;
      clearE2EHandle();
    };
  });

  // ── QA hook (E2E only) ──────────────────────────────────────────────────────
  // Headless `$B` browse has no WebGL and CDP can't drive zoom, so the zoom-tiered
  // LOD has been un-QA-able. When the page is opened with ?e2e=1 we expose the live
  // maplibre map + a ready flag on window so a Playwright/SwiftShader run can call
  // setZoom + queryRenderedFeatures and assert which line tiers are visible. The hook
  // code ships in the bundle but stays inert without ?e2e, so a normal user never
  // receives the handle. See tests/e2e/map-lod.spec.ts.
  interface E2EWindow {
    __map?: unknown;
    __mapReady?: boolean;
  }
  const E2E_READY_POLL_MS = 100;
  const E2E_READY_MAX_TICKS = 100; // ≤10s — bounded so the poll can't spin forever
  let e2eReadyTimer: ReturnType<typeof setTimeout> | null = null;
  function e2eEnabled(): boolean {
    return (
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('e2e')
    );
  }
  function exposeE2EHandle(): void {
    if (!e2eEnabled() || !map) return;
    // Cancel any poll chain still running from a prior mount/HMR before starting a new one,
    // so an earlier chain can't keep ticking against a stale map.
    if (e2eReadyTimer !== null) {
      clearTimeout(e2eReadyTimer);
      e2eReadyTimer = null;
    }
    const w = window as unknown as E2EWindow;
    w.__map = map;
    w.__mapReady = false;
    // Readiness polls map.loaded() rather than the 'load'/'idle' events: under a flaky or
    // offline basemap (e.g. CI with no internet) the raster source retries forever so those
    // events never fire, but loaded() still flips true once the local rail layers are
    // rendered and queryable — which is all the LOD assertions need. Bounded + cancellable:
    // if loaded() never settles within the cap, we stop and leave __mapReady false so the
    // test's readiness wait fails loudly instead of the poll spinning against a dead map.
    const m = map;
    let ticks = 0;
    const markReady = (): void => {
      if (m.loaded()) {
        w.__mapReady = true;
        e2eReadyTimer = null;
        return;
      }
      if (++ticks >= E2E_READY_MAX_TICKS) {
        e2eReadyTimer = null;
        return;
      }
      e2eReadyTimer = setTimeout(markReady, E2E_READY_POLL_MS);
    };
    markReady();
  }
  function clearE2EHandle(): void {
    if (typeof window === 'undefined') return;
    if (e2eReadyTimer !== null) {
      clearTimeout(e2eReadyTimer);
      e2eReadyTimer = null;
    }
    const w = window as unknown as E2EWindow;
    delete w.__map;
    delete w.__mapReady;
  }

  function fitToNetwork(): void {
    const pkgs = get(packages);
    // Frame where you've actually ridden; else the JP network; else everything.
    const jp = pkgs.filter((p) => p.country === 'JP');
    const b =
      riddenBounds(get(litSegmentIds), pkgs) ?? networkBounds(jp.length ? jp : pkgs);
    if (!b || !map) return;
    map.fitBounds(b, { padding: 64, duration: 0, maxZoom: 13 });
  }

  function wireStationClicks(): void {
    if (!map || !mapLib) return;
    // C5 — a single reusable HTML popup (NOT a glyph/symbol layer) for the bilingual name.
    popup = new mapLib.Popup({ closeButton: false, closeOnClick: false, offset: 10 });

    map.on('click', STATIONS_LAYER, (e: { features?: { properties: Record<string, unknown> }[] }) => {
      const feats = e.features ?? [];
      if (feats.length === 0) return;
      // A transfer station (e.g. 渋谷) is several coincident features, one per line. When a
      // line is picked, prefer the feature ON that line so the tap isn't wrongly rejected.
      const match = selectedLine
        ? feats.find((ft) => String(ft.properties.lineId) === selectedLine!.lineId)
        : undefined;
      const f = match ?? feats[0];
      showPopup(f.properties);
      onStationTap(String(f.properties.stationId), String(f.properties.name), String(f.properties.lineId));
    });
    // C5 — hover popup with name（日本語）+ nameRoma. mousemove keeps it pinned to the dot.
    map.on('mousemove', STATIONS_LAYER, (e: { features?: { properties: Record<string, unknown> }[] }) => {
      if (map) map.getCanvas().style.cursor = markActive ? 'pointer' : 'default';
      const f = (e.features ?? [])[0];
      if (f) showPopup(f.properties);
    });
    map.on('mouseleave', STATIONS_LAYER, () => {
      if (map) map.getCanvas().style.cursor = '';
      popup?.remove();
    });
  }

  // C7 — surface the line-logo attribution. Commons logos (P154) need per-file credit; the
  // engine lane ships `/rail/logo-credits.json`. We fetch it resiliently (missing file → no-op,
  // logos just won't have a visible Commons credit yet) and append a compact credit line to the
  // map's ⓘ attribution control, beside the existing N02 + OSM/ODbL credits.
  async function surfaceLogoCredits(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}rail/logo-credits.json`);
      if (!res.ok) return;
      const data = (await res.json()) as
        | { attribution?: string; credits?: { author?: string; license?: string }[] }
        | Record<string, { author?: string; license?: string }>;
      const credit = logoCreditLine(data);
      if (!credit || !map) return;
      // Append via a transient geojson source's attribution (cheapest: re-set the rail source's
      // attribution is not supported live, so add a no-feature source carrying the credit text).
      if (!map.getSource('rp-logo-credit')) {
        map.addSource('rp-logo-credit', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          attribution: credit,
        });
      }
    } catch {
      // offline / malformed — logos still render; the credit is simply not shown this session.
    }
  }

  // Reduce a logo-credits payload to ONE compact attribution line. Tolerant of either an
  // explicit `attribution` string, a `credits` array, or a map of per-line credit objects.
  function logoCreditLine(data: unknown): string {
    if (!data || typeof data !== 'object') return '';
    const obj = data as Record<string, unknown>;
    if (typeof obj.attribution === 'string' && obj.attribution.trim()) return obj.attribution.trim();
    const collectLicenses = (entries: { license?: unknown }[]): string => {
      const licenses = new Set<string>();
      for (const e of entries) if (typeof e?.license === 'string' && e.license) licenses.add(e.license);
      const list = [...licenses].slice(0, 4).join(', ');
      return list ? `路線ロゴ: Wikimedia Commons（${list}）` : '路線ロゴ: Wikimedia Commons';
    };
    if (Array.isArray(obj.credits)) return collectLicenses(obj.credits as { license?: unknown }[]);
    const values = Object.values(obj).filter((v) => v && typeof v === 'object') as { license?: unknown }[];
    if (values.length) return collectLicenses(values);
    return '';
  }

  // C5 — render the hover→lines popup at the station's coordinates. Header = bilingual station
  // name; below it, ONE ROW PER LINE through the physical station (its cross-line group), each
  // `[logo <img> | color swatch] 線名 (Romaji)`. Missing logo → the color swatch. The list
  // scrolls past ~6 lines (新宿 has 7). The model + HTML are built by the pure popup module.
  function showPopup(props: Record<string, unknown>): void {
    if (!map || !popup) return;
    const idx = get(geo);
    const stationId = String(props.stationId);
    const st = idx.stationById.get(stationId);
    const lon = st?.lon;
    const lat = st?.lat;
    if (lon === undefined || lat === undefined) return;
    const model = buildPopupModel(idx, stationId, String(props.lineId));
    if (!model) return;
    popup.setLngLat([lon, lat]).setHTML(popupHtml(model)).addTo(map);
  }

  // ── lit-set → paint updates (lit-keyed channels only; line color is STATIC per C1) ──
  // C2: ridden-state rides OPACITY + WIDTH. The base line-color is the static ['get','color']
  // set once at layer-add and is NEVER re-set here, so the flood sweeps in each line's own hue.
  function repaint(lit: string[]): void {
    if (!map || !styleLoaded) return;
    const litStations = litStationIds(lit, get(packages));
    map.setPaintProperty(SEGMENTS_LAYER, 'line-opacity', lineOpacityExpression(lit));
    map.setPaintProperty(SEGMENTS_LAYER, 'line-width', lineWidthExpression(lit));
    map.setPaintProperty(SEGMENTS_GLOW_LAYER, 'line-width', glowWidthExpression(lit));
    map.setPaintProperty(SEGMENTS_GLOW_LAYER, 'line-opacity', glowOpacityExpression(lit));
    map.setPaintProperty(STATIONS_LAYER, 'circle-color', stationColorExpression(litStations));
    map.setPaintProperty(STATIONS_LAYER, 'circle-radius', stationRadiusExpression(litStations));
    applyLodFilters(lit, litStations);
  }

  // C9 LOD — refresh the zoom-tier visibility filters. The "always-visible" clause is the
  // current ridden set + the selected line, so your ridden network and a picked line stay
  // visible at every zoom while everything else reveals by tier. Called on every lit change
  // (the flood) AND on selection change (so a picked minor line is visible to tap).
  function applyLodFilters(lit: string[], litStations: string[]): void {
    if (!map || !styleLoaded) return;
    const pkgs = get(packages);
    const selSeg = selectedLine ? selectedLineSegmentIds(selectedLine, pkgs) : [];
    const selSt = selectedLine ? selectedLineStationIds(selectedLine, pkgs) : [];
    map.setFilter(SEGMENTS_LAYER, lodFilter('segmentId', lit, selSeg));
    map.setFilter(STATIONS_LAYER, lodFilter('stationId', litStations, selSt));
  }

  // React to litSegmentIds changes: small/equal → snap; big grow → D5 flood wave.
  $effect(() => {
    const lit = $litSegmentIds;
    if (!map || !styleLoaded) {
      prevLit = lit;
      return;
    }
    const added = diffNewlyLit(prevLit, lit);
    cancelFlood?.();
    if (added.length === 0) {
      // a removal or no-op — just repaint to the new truth.
      repaint(lit);
    } else {
      const plan = buildFloodPlan(prevLit, added, midpoints, {
        reducedMotion: prefersReducedMotion(),
      });
      cancelFlood = runFlood(plan, (frameLit) => repaint(frameLit));
    }
    prevLit = lit;
  });

  // ── C3: DARK CASING selection underlay ─────────────────────────────────────────
  // When a line is selected (picked OR inferred), paint its whole length as a wide DARK casing
  // UNDERLAY + dark station rings via setFilter on the dedicated layers (NO setFeatureState —
  // design rule). The casing sits below the base line so its own hue shows on top and the dark
  // halo around it reads as "selected" — visible on the near-white basemap. Cleared on deselect.
  $effect(() => {
    const line = selectedLine;
    if (!map || !styleLoaded) return;
    const segIds = selectedLineSegmentIds(line, get(packages));
    const stIds = selectedLineStationIds(line, get(packages));
    map.setFilter(SELECTION_CASING_LAYER, inFilter('segmentId', segIds));
    map.setFilter(HIGHLIGHT_STATION_LAYER, inFilter('stationId', stIds));
    // C9 LOD: re-apply visibility so the selected line shows even if its tier zoom isn't reached.
    const curLit = get(litSegmentIds);
    applyLodFilters(curLit, litStationIds(curLit, get(packages)));
  });

  // ── marking interaction ──────────────────────────────────────────────────────
  function pickLine(line: RailLine): void {
    selectedLine = line;
    stationA = null;
    stationAName = null;
  }

  function backToLinePicker(): void {
    selectedLine = null;
    stationA = null;
    stationAName = null;
  }

  async function onStationTap(stationId: string, name: string, lineId: string): Promise<void> {
    if (!markActive || busy) return;
    // Must pick a line first (line-first marking, DESIGN issue 5).
    if (!selectedLine) {
      toast('先に路線を選んでください', 'info');
      return;
    }
    if (lineId !== selectedLine.lineId) {
      // The tapped station belongs to another line — guard the cross-line case.
      toast(`「${selectedLine.name}」の駅をタップしてください`, 'info');
      return;
    }
    if (!stationA) {
      stationA = stationId;
      stationAName = name;
      return;
    }
    if (stationA === stationId) {
      // tapped A again — treat as deselect of A.
      stationA = null;
      stationAName = null;
      return;
    }
    await doMark(stationA, stationId);
  }

  async function doMark(from: string, to: string): Promise<void> {
    if (!selectedLine) return;
    const pkg = get(packages).find((p) => p.lines.some((l) => l.lineId === selectedLine!.lineId));
    if (!pkg) {
      toast('地図の読み込みに失敗', 'error');
      return;
    }
    busy = true;
    try {
      const before = new Set(get(litSegmentIds));
      const res = await markRide({
        lineId: selectedLine.lineId,
        fromStationId: from,
        toStationId: to,
        pkg,
        trainModel: markTrainModel.trim() || undefined,
      });
      if (res.sliceLength === 0) {
        toast('同じ駅が選ばれています', 'info');
        return;
      }
      // E1: every mark appends a new trip. "Newly lit" = the slice's segments not already
      // covered, so the coverage toast still reads as % gained; a full repeat says so plainly.
      const newlyLit = res.segmentIds.filter((id) => !before.has(id));
      if (newlyLit.length === 0) {
        toast(`もう一度記録しました（${res.sliceLength}区間）`, 'success');
      } else {
        const km = kmOf(newlyLit);
        toast(`区間を記録しました（+${newlyLit.length}区間 / +${km.toFixed(1)} km）`, 'success');
      }
      pulse(res.segmentIds);
      markTrainModel = '';
      markMode.set(false); // exit mark mode after a successful mark
    } catch (err) {
      // segmentsBetween throws for cross-line / no-path; surface gently.
      console.error('[MapView] markRide failed', err);
      toast('この区間は記録できません（同じ路線の駅を選んでください）', 'error');
    } finally {
      busy = false;
      stationA = null;
      stationAName = null;
    }
  }

  // Sum of build-time km over a set of segmentIds, via the shared geo index — one helper for
  // both mark paths' toasts (tap-mark and route) so they never compute the same number two ways.
  function kmOf(ids: string[]): number {
    const segById = get(geo).segmentById;
    return ids.reduce((sum, id) => sum + (segById.get(id)?.km ?? 0), 0);
  }

  // ── C4: station-first typed entry ───────────────────────────────────────────────
  // Type A → resolve (disambiguate transfer via a list) → type B → resolve → infer the line
  // (disambiguate multi-share) → reuse doMark. Setting the inferred line fires C1's red highlight.
  function switchEntry(mode: 'tap' | 'search'): void {
    if (entryMode === mode) return;
    resetSearch();
    entryMode = mode;
    // leaving search clears any inference-only line selection so the highlight goes away.
    if (mode === 'tap') selectedLine = null;
  }

  async function resolveInto(which: 'A' | 'B', raw: string): Promise<void> {
    const seq = ++searchSeq;
    const hits = await resolveQuery(raw, searchIndex);
    if (seq !== searchSeq) return; // a newer keystroke superseded this resolve
    if (which === 'A') {
      pickedA = null;
      routeChoices = [];
      noRoute = false;
      hitsA = hits;
    } else {
      pickedB = null;
      routeChoices = [];
      noRoute = false;
      hitsB = hits;
    }
    // No auto-pick: a partial query can match one station that's a prefix of the one you want
    // (e.g. "nago" matches 名郷 but you're typing 名古屋), so picking mid-type would grab the wrong
    // station. Always show the matches as tappable suggestions; the user chooses when ready.
  }

  function onQueryA(e: Event): void {
    queryA = (e.target as HTMLInputElement).value;
    selectedLine = null;
    void resolveInto('A', queryA);
  }
  function onQueryB(e: Event): void {
    queryB = (e.target as HTMLInputElement).value;
    selectedLine = null;
    void resolveInto('B', queryB);
  }

  function pickHit(which: 'A' | 'B', hit: StationHit): void {
    if (which === 'A') {
      pickedA = hit;
      hitsA = [];
    } else {
      pickedB = hit;
      hitsB = [];
    }
    void tryInfer();
  }

  // Once both endpoints are pinned, find the cross-line route(s) and let the user pick. A single-line
  // A→B is just the degenerate 0-change route — same picker, no special case (the search-mode unify).
  // findRoutes is synchronous and bounded (caps), but a long national pair can take ~250ms, so we paint
  // a "探索中" state first (yield a frame) rather than freeze silently.
  async function tryInfer(): Promise<void> {
    routeChoices = [];
    noRoute = false;
    if (!pickedA || !pickedB) return;
    const a = pickedA;
    const b = pickedB;
    if (a.station.stationId === b.station.stationId) {
      toast('出発駅と到着駅が同じです', 'info');
      return;
    }
    const pkg = get(packages).find((p) => p.lines.some((l) => l.lineId === a.line.lineId));
    if (!pkg) {
      toast('地図の読み込みに失敗', 'error');
      return;
    }
    searching = true;
    await new Promise((r) => requestAnimationFrame(() => r(null))); // let the 探索中 state paint
    if (pickedA !== a || pickedB !== b) {
      searching = false;
      return; // a newer pick superseded this one
    }
    let routes: RouteCandidate[];
    try {
      routes = findRoutes(pkg, groupKeyForHit(a), groupKeyForHit(b));
    } finally {
      searching = false;
    }
    // Surface a route on the line the user actually picked first — never float a parallel Shinkansen
    // above the local line they rode (which would tempt a one-tap phantom HSR mark).
    routes = preferPickedLine(routes, new Set([a.line.lineId, b.line.lineId]));
    if (routes.length === 0) {
      noRoute = true; // warm no-route state with a leg-by-leg fallback
      return;
    }
    if (routes.length === 1) {
      void commitRoute(routes[0]);
      return;
    }
    routeChoices = routes; // ≥2 candidates — show the route-picker
  }

  function pickRoute(r: RouteCandidate): void {
    void commitRoute(r);
  }

  async function commitRoute(r: RouteCandidate): Promise<void> {
    routeChoices = [];
    noRoute = false;
    if (busy) return;
    busy = true;
    try {
      const before = new Set(get(litSegmentIds));
      const res = await markRoute(r, { trainModel: markTrainModel.trim() || undefined });
      // E1: the route is always recorded as a new trip. Report newly-lit coverage; a full
      // repeat (every leg already ridden) says so instead of dead-ending.
      const newlyLit = r.segmentIds.filter((id) => !before.has(id));
      if (newlyLit.length === 0) {
        toast(`もう一度記録しました（${r.segmentIds.length}区間 / ${res.totalKm.toFixed(1)} km）`, 'success');
      } else {
        const km = kmOf(newlyLit);
        toast(`経路を記録しました（+${newlyLit.length}区間 / +${km.toFixed(1)} km）`, 'success');
      }
      pulse(r.segmentIds);
      markTrainModel = '';
      markMode.set(false); // exit mark mode (resets search) on success
    } catch (err) {
      console.error('[MapView] markRoute failed', err);
      toast('経路を記録できませんでした', 'error');
    } finally {
      busy = false;
    }
  }

  // No-route fallback: drop to tap-mode so the user records each leg on its own line.
  function fallbackToLegByLeg(): void {
    noRoute = false;
    switchEntry('tap');
  }

  // Motion beat #2: a brief pulse on the freshly-marked segment(s). The non-pulsed
  // segments keep their steady-state glow (lit → 0.18, unlit → 0) while the marked ones
  // flash brighter. Gated by prefers-reduced-motion.
  function pulse(ids: string[]): void {
    if (!map || !styleLoaded || prefersReducedMotion() || ids.length === 0) return;
    const pulsed = ['in', ['get', 'segmentId'], ['literal', ids]];
    const steady = glowOpacityExpression(get(litSegmentIds));
    let t = 0;
    const steps = 6;
    const beat = (): void => {
      if (!map || !styleLoaded) return;
      t++;
      const on = t % 2 === 1;
      // pulsed → flash; everyone else → steady-state expression.
      map.setPaintProperty(SEGMENTS_GLOW_LAYER, 'line-opacity', [
        'case',
        pulsed,
        on ? 0.55 : 0.2,
        steady,
      ]);
      if (t < steps) {
        window.setTimeout(beat, 120);
      } else {
        repaint(get(litSegmentIds)); // restore the steady-state glow
      }
    };
    beat();
  }

  function retry(): void {
    status = 'loading';
    styleLoaded = false;
    map?.remove?.();
    map = null;
    // re-run init by remounting the container key
    void tick().then(() => location.reload());
  }

  // expose for testing-free a11y label
  const segmentCount = $derived($packages.reduce((n, p) => n + p.segments.length, 0));

  // C6 — a line's display color for the swatch fallback (used in chips/search/panel markup).
  function lineColor(line: RailLine): string {
    return line.color ?? DEFAULT_LINE_COLOR;
  }
</script>

<!-- C6 — a line's leading mark: its logo (normalized to ~16px HEIGHT, width auto) when present,
     else a color swatch in the line's official hue. Reused in every place a line is named. -->
{#snippet lineMark(line: RailLine)}
  {#if line.logo}
    <img class="line-logo" src={line.logo} alt="" loading="lazy" />
  {:else}
    <span class="line-swatch" style={`background:${lineColor(line)}`} aria-hidden="true"></span>
  {/if}
{/snippet}

<!-- C8 — the railway company, muted, to the LEFT of the logo + name. A SIBLING of the
     badge (not inside it), de-duped when the line name already leads with the brand. -->
{#snippet companyTag(line: RailLine)}
  {#if companyFor(line.operator, line.name)}<span class="line-co">{companyFor(line.operator, line.name)}</span>{/if}
{/snippet}

<!-- A route candidate as a chip. 1 line = today's plain chip (degenerate 0-change route); ≥2 lines =
     a two-line route chip: logo sequence joined by › on top, "km · 区間 · N路線" below. "おすすめ" on
     rank-1 (a nudge, not a claim). aria-label reads the route so SRs don't hear "image image image". -->
{#snippet routeChip(r: RouteCandidate, rank: number)}
  {@const lns = r.lines.map((id) => $geo.lineById.get(id)).filter((l): l is RailLine => !!l)}
  {#if lns.length <= 1}
    <button class="line-chip" onclick={() => pickRoute(r)}>
      {#if lns[0]}{@render companyTag(lns[0])}{@render lineMark(lns[0])}<span class="line-name" title={bilingualLabel(lns[0].name, lns[0].nameRoma)}>{bilingualLabel(lns[0].name, lns[0].nameRoma)}</span>{#if lns[0].isHSR}<span class="hsr">新幹線</span>{/if}{/if}
    </button>
  {:else}
    <button
      class="route-chip"
      onclick={() => pickRoute(r)}
      aria-label={`${lns.map((l) => l.name).join('、')}経由 ${r.totalKm.toFixed(1)}キロ ${r.lines.length}路線`}
    >
      <span class="route-lines">
        {#each lns as l, i (l.lineId + ':' + i)}
          {#if i > 0}<span class="route-sep" aria-hidden="true">›</span>{/if}
          {@render lineMark(l)}
          <span class="route-line-name">{l.name}</span>
        {/each}
        {#if rank === 0 && routeChoices.length > 1}<span class="route-rec">おすすめ</span>{/if}
      </span>
      <span class="route-meta">{r.totalKm.toFixed(1)} km · {r.segmentIds.length}区間 · {r.lines.length}路線</span>
    </button>
  {/if}
{/snippet}

<div class="map-root">
  <div
    bind:this={container}
    class="map-canvas"
    class:hidden={status !== 'ready'}
    role="region"
    aria-label={`鉄道ネットワーク地図 — 全${segmentCount}区間`}
  ></div>

  {#if status === 'loading'}
    <!-- D4 loading: skeleton grey network fading in. -->
    <div class="overlay skeleton" aria-hidden="true">
      <svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
        <g stroke={tokens.railDim} stroke-width="2" fill="none" stroke-linecap="round">
          <path d="M30 60 L90 40 L150 70 L170 120" />
          <path d="M40 150 L100 130 L120 90" />
          <circle cx="55" cy="120" r="30" />
        </g>
      </svg>
      <p class="u-muted">地図を読み込み中…</p>
    </div>
  {:else if status === 'error'}
    <!-- D4 error: message + retry. -->
    <div class="overlay error" role="alert">
      <p class="msg">地図の読み込みに失敗</p>
      <button class="retry" onclick={retry}>再試行</button>
    </div>
  {/if}

  {#if status === 'ready' && markActive}
    <!-- Line-first marking (DESIGN issue 5) + station-first typed entry (C4). -->
    <div class="mark-panel" role="group" aria-label="区間をマーク">
      <!-- Entry-mode toggle: tap the map, or type station names. -->
      <div class="entry-tabs" role="tablist" aria-label="記録方法">
        <button
          class="entry-tab"
          class:active={entryMode === 'tap'}
          role="tab"
          aria-selected={entryMode === 'tap'}
          onclick={() => switchEntry('tap')}
        >地図でタップ</button>
        <button
          class="entry-tab"
          class:active={entryMode === 'search'}
          role="tab"
          aria-selected={entryMode === 'search'}
          onclick={() => switchEntry('search')}
        >駅名で検索</button>
      </div>

      {#if entryMode === 'tap'}
        {#if !selectedLine}
          <p class="mark-title">路線を選択</p>
          <div class="line-list">
            {#each lineGroups as group (group.country)}
              {#each group.lines as line (line.lineId)}
                <button class="line-chip" onclick={() => pickLine(line)}>
                  {@render companyTag(line)}
                  {@render lineMark(line)}
                  <span class="line-name" title={bilingualLabel(line.name, line.nameRoma)}>{bilingualLabel(line.name, line.nameRoma)}</span>
                  {#if line.isHSR}<span class="hsr">新幹線</span>{/if}
                </button>
              {/each}
            {/each}
          </div>
        {:else}
          <div class="mark-step">
            <button class="back" onclick={backToLinePicker} aria-label="路線選択に戻る">‹</button>
            <span class="picked">{@render companyTag(selectedLine)}{@render lineMark(selectedLine)}<span class="picked-name">{bilingualLabel(selectedLine.name, selectedLine.nameRoma)}</span>{#if selectedLine.isHSR}<span class="hsr">新幹線</span>{/if}</span>
          </div>
          <p class="mark-hint" aria-live="polite">
            {#if !stationA}
              地図上で<strong>出発駅</strong>をタップ
            {:else}
              <strong>{stationAName}</strong> から<strong>到着駅</strong>をタップ
            {/if}
          </p>
        {/if}
      {:else}
        <!-- C4 station-first search: type A → resolve → type B → infer the line. -->
        <div class="search-field">
          <label class="search-label" for="rp-q-a">出発駅</label>
          {#if pickedA}
            <div class="picked-station">
              <span class="picked-station-label">{bilingualLabel(pickedA.station.name, pickedA.station.nameRoma)} · {@render companyTag(pickedA.line)}{@render lineMark(pickedA.line)}{pickedA.line.name}</span>
              <button class="clear" aria-label="出発駅をクリア" onclick={() => { pickedA = null; queryA = ''; tryInfer(); }}>×</button>
            </div>
          {:else}
            <input
              id="rp-q-a"
              class="search-input"
              type="text"
              placeholder="例: 新宿 / Shinjuku / しんじゅく"
              value={queryA}
              oninput={onQueryA}
              autocomplete="off"
            />
            {#if hitsA.length >= 1}
              <ul class="hit-list" aria-label="出発駅の候補">
                {#each hitsA as h (h.station.stationId)}
                  <li>
                    <button class="hit" onclick={() => pickHit('A', h)}>
                      <span class="hit-name">{bilingualLabel(h.station.name, h.station.nameRoma)}</span>
                      <span class="hit-line">{@render companyTag(h.line)}{@render lineMark(h.line)}{h.line.name}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
        </div>

        <div class="search-field">
          <label class="search-label" for="rp-q-b">到着駅</label>
          {#if pickedB}
            <div class="picked-station">
              <span class="picked-station-label">{bilingualLabel(pickedB.station.name, pickedB.station.nameRoma)} · {@render companyTag(pickedB.line)}{@render lineMark(pickedB.line)}{pickedB.line.name}</span>
              <button class="clear" aria-label="到着駅をクリア" onclick={() => { pickedB = null; queryB = ''; tryInfer(); }}>×</button>
            </div>
          {:else}
            <input
              id="rp-q-b"
              class="search-input"
              type="text"
              placeholder="例: 渋谷 / Shibuya"
              value={queryB}
              oninput={onQueryB}
              autocomplete="off"
            />
            {#if hitsB.length >= 1}
              <ul class="hit-list" aria-label="到着駅の候補">
                {#each hitsB as h (h.station.stationId)}
                  <li>
                    <button class="hit" onclick={() => pickHit('B', h)}>
                      <span class="hit-name">{bilingualLabel(h.station.name, h.station.nameRoma)}</span>
                      <span class="hit-line">{@render companyTag(h.line)}{@render lineMark(h.line)}{h.line.name}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
        </div>

        {#if searching}
          <p class="mark-hint" aria-live="polite">経路を探索中…</p>
        {:else if routeChoices.length > 0}
          <!-- Cross-line route picker: pick the way you actually rode (a single-line A→B is just
               the degenerate 0-change route, rendered as a plain chip). -->
          <p class="mark-title">経路を選択</p>
          <div class="line-list">
            {#each routeChoices as r, i (r.segmentIds.join())}
              {@render routeChip(r, i)}
            {/each}
          </div>
        {:else if noRoute}
          <!-- Empty state is a feature: warm message + a way forward, never a dead end. -->
          <div class="no-route" role="status">
            <p class="no-route-title">経路が見つかりませんでした</p>
            <p class="no-route-sub">この2駅をつなぐ線路がありません。</p>
            <button class="no-route-action" onclick={fallbackToLegByLeg}>各区間を分けて記録</button>
          </div>
        {/if}
      {/if}

      {#if (entryMode === 'tap' && selectedLine) || entryMode === 'search'}
        <!-- T2: optional train-model capture — never blocks a mark; read by both mark paths. -->
        <div class="train-field">
          <label class="search-label" for="rp-train">車両 <span class="opt u-muted">(任意)</span></label>
          <input
            id="rp-train"
            class="search-input"
            type="text"
            placeholder="例: N700S / E5系 / CR400AF"
            bind:value={markTrainModel}
            autocomplete="off"
          />
          {#if modelSuggestions.length > 0}
            <div class="train-chips" role="group" aria-label="車両の候補">
              {#each modelSuggestions as m (m)}
                <Pill
                  active={markTrainModel.trim() === m}
                  onclick={() => (markTrainModel = markTrainModel.trim() === m ? '' : m)}
                >{m}</Pill>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .map-root {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 320px;
    background: var(--rail-bg);
    overflow: hidden;
  }
  .map-canvas {
    position: absolute;
    inset: 0;
  }
  .map-canvas.hidden {
    visibility: hidden;
  }

  /* maplibre injects its own canvas styles via the imported CSS. */
  :global(.maplibregl-map) {
    font-family: var(--font-family);
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-md);
    background: var(--rail-bg);
  }
  .skeleton svg {
    width: 50%;
    max-width: 240px;
    opacity: 0;
    animation: fade-in 0.9s ease forwards;
  }
  @keyframes fade-in {
    to {
      opacity: 0.7;
    }
  }
  .error .msg {
    font-size: var(--size-stat);
    font-weight: var(--weight-label);
    color: var(--ink);
  }
  .retry {
    min-height: 44px;
    padding: 0 var(--space-xl);
    border-radius: var(--radius-button);
    background: var(--rail-text);
    color: var(--white);
    border: none;
    font-size: var(--size-stat);
    font-weight: var(--weight-label);
  }

  /* ── line-first marking panel ── */
  .mark-panel {
    position: absolute;
    top: var(--space-md);
    left: var(--space-md);
    right: var(--space-md);
    max-width: 360px;
    background: var(--white);
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-card);
    box-shadow: 0 6px 22px rgba(26, 26, 26, 0.12);
    padding: var(--space-md);
    z-index: 30;
  }
  .mark-title {
    font-size: var(--size-label);
    font-weight: var(--weight-label);
    color: var(--rail-text);
    margin-bottom: var(--space-sm);
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .line-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    max-height: 46vh;
    overflow-y: auto;
  }
  .line-chip {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    min-height: 44px;
    padding: 0 var(--space-md);
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-button);
    background: var(--white);
    color: var(--ink);
    font-size: var(--size-body);
    text-align: left;
  }
  .line-chip:active {
    transform: scale(0.99);
  }
  /* C6 — line mark: a logo (fixed 16px HEIGHT, width auto, left-aligned) or a color swatch. */
  :global(.line-logo) {
    height: 16px;
    width: auto;
    max-width: 48px;
    object-fit: contain;
    flex: none;
    display: block;
  }
  :global(.line-swatch) {
    width: 14px;
    height: 6px;
    border-radius: 3px;
    flex: none;
    display: inline-block;
  }
  .line-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* C8 — railway company: muted secondary label, left of logo + name. #6B756F = ink-muted
     (DESIGN.md "secondary text, labels"; AA on white). Stays grey — monochrome discipline. */
  :global(.line-co) {
    flex: none;
    font-size: 0.78em;
    color: var(--ink-muted);
    white-space: nowrap;
    max-width: 8em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hsr {
    font-size: var(--size-label);
    font-weight: var(--weight-label);
    color: var(--white);
    background: var(--rail-text);
    border-radius: var(--radius-pill);
    padding: 2px 8px;
    margin-left: 6px;
  }
  /* Cross-line route chip: two lines, taller than .line-chip; sequence may wrap on long routes. */
  .route-chip {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    min-height: 56px;
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-button);
    background: var(--white);
    color: var(--ink);
    font-size: var(--size-body);
    text-align: left;
    width: 100%;
  }
  .route-chip:active {
    transform: scale(0.99);
  }
  .route-lines {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    width: 100%;
  }
  .route-line-name {
    font-size: 0.9em;
  }
  .route-sep {
    color: var(--ink-muted);
    padding: 0 1px;
  }
  /* C8 discipline: rank-1 nudge stays muted grey, not emerald — a hint, not a claim. */
  .route-rec {
    margin-left: auto;
    font-size: var(--size-label);
    font-weight: var(--weight-label);
    color: var(--ink-muted);
    background: var(--rail-dim);
    border-radius: var(--radius-pill);
    padding: 1px 8px;
  }
  .route-meta {
    font-size: 0.82em;
    color: var(--ink-muted);
  }
  .no-route {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-md) var(--space-sm);
    text-align: center;
  }
  .no-route-title {
    font-weight: var(--weight-label);
    color: var(--ink);
  }
  .no-route-sub {
    font-size: 0.85em;
    color: var(--ink-muted);
  }
  .no-route-action {
    align-self: center;
    margin-top: var(--space-xs);
    min-height: 44px;
    padding: 0 var(--space-lg);
    border: none;
    border-radius: var(--radius-button);
    background: var(--rail-text);
    color: var(--white);
    font-size: var(--size-body);
    font-weight: var(--weight-label);
  }
  .mark-step {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin-bottom: var(--space-sm);
  }
  .back {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--rail-dim);
    background: var(--white);
    color: var(--rail-text);
    font-size: 18px;
    line-height: 1;
  }
  .picked {
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
    font-size: var(--size-stat);
    font-weight: var(--weight-label);
    color: var(--ink);
  }
  .mark-hint {
    font-size: var(--size-body);
    color: var(--ink-muted);
    line-height: 1.6;
  }
  .mark-hint strong {
    color: var(--rail-text);
    font-weight: var(--weight-label);
  }

  /* ── entry-mode tabs (tap / search) ── */
  .entry-tabs {
    display: flex;
    gap: var(--space-xs);
    margin-bottom: var(--space-sm);
  }
  .entry-tab {
    flex: 1;
    min-height: 36px;
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-button);
    background: var(--white);
    color: var(--ink-muted);
    font-size: var(--size-body);
  }
  .entry-tab.active {
    background: var(--rail-bg);
    color: var(--rail-text);
    font-weight: var(--weight-label);
    border-color: var(--rail-text);
  }

  /* ── station-first search ── */
  .search-field {
    margin-bottom: var(--space-sm);
  }
  .search-label {
    display: block;
    font-size: var(--size-label);
    font-weight: var(--weight-label);
    color: var(--ink-muted);
    margin-bottom: 4px;
  }
  .search-input {
    width: 100%;
    min-height: 44px;
    padding: 0 var(--space-md);
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-button);
    background: var(--white);
    color: var(--ink);
    font-size: var(--size-body);
    box-sizing: border-box;
  }
  .search-input:focus {
    outline: 2px solid var(--rail-text);
    outline-offset: 1px;
  }
  /* T2 optional train-model capture — a quiet section below the mark step, never blocking. */
  .train-field {
    margin-top: var(--space-md);
    padding-top: var(--space-md);
    border-top: 1px solid var(--rail-dim);
  }
  .opt {
    font-weight: 400;
  }
  .train-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    margin-top: var(--space-sm);
  }
  .hit-list {
    list-style: none;
    margin: var(--space-xs) 0 0;
    padding: 0;
    max-height: 32vh;
    overflow-y: auto;
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-button);
  }
  .hit {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-sm);
    width: 100%;
    min-height: 44px;
    padding: 0 var(--space-md);
    border: none;
    border-bottom: 1px solid var(--rail-bg);
    background: var(--white);
    color: var(--ink);
    font-size: var(--size-body);
    text-align: left;
  }
  .hit-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hit-line {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--ink-muted);
    font-size: var(--size-label);
    flex: 0 1 auto;
    min-width: 0;
    max-width: 60%;
    overflow: hidden;
    white-space: nowrap;
  }
  .picked-station-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .picked-station {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    min-height: 44px;
    padding: 0 var(--space-md);
    border: 1px solid var(--rail-text);
    border-radius: var(--radius-button);
    background: var(--rail-bg);
    color: var(--ink);
    font-size: var(--size-body);
  }
  .clear {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-pill);
    border: none;
    background: transparent;
    color: var(--ink-muted);
    font-size: 18px;
    line-height: 1;
    flex: none;
  }

  /* ── C5 hover→lines popup (HTML, NOT a glyph layer) ── */
  :global(.rp-popup) {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    padding: 2px 2px;
    min-width: 140px;
    max-width: 240px;
  }
  :global(.rp-popup-head) {
    display: flex;
    flex-direction: column;
  }
  :global(.rp-popup-ja) {
    font-size: var(--size-body);
    font-weight: var(--weight-label);
    color: var(--ink);
  }
  :global(.rp-popup-roma) {
    font-size: var(--size-label);
    color: var(--ink-muted);
  }
  /* One row per line through the station; scrolls past ~6 lines (新宿 has 7). */
  :global(.rp-line-list) {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 168px; /* ~6 rows then scroll */
    overflow-y: auto;
  }
  :global(.rp-line-row) {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--size-label);
    color: var(--ink);
    min-height: 18px;
  }
  :global(.rp-line-name) {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* C8 — company label in the hover popup: muted, left of the badge (matches .line-co). */
  :global(.rp-line-co) {
    flex: none;
    font-size: 0.82em;
    color: var(--ink-muted);
    white-space: nowrap;
    max-width: 7em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Popup-scoped copies of the C6 line mark (the popup is innerHTML, outside Svelte scoping). */
  :global(.rp-line-logo) {
    height: 16px;
    width: auto;
    max-width: 48px;
    object-fit: contain;
    flex: none;
    display: block;
  }
  :global(.rp-line-swatch) {
    width: 14px;
    height: 6px;
    border-radius: 3px;
    flex: none;
    display: inline-block;
  }
  :global(.maplibregl-popup-content) {
    padding: 6px 10px;
    border-radius: var(--radius-button);
    box-shadow: 0 4px 14px rgba(26, 26, 26, 0.18);
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton svg {
      animation: none;
      opacity: 0.7;
    }
  }
</style>
