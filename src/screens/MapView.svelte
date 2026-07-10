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
  import {
    packages,
    litSegmentIds,
    geo,
    events,
    markRide,
    markRoute,
    removeTrip,
    collection,
    collectedModelKeys,
    celebrateNewMilestones,
  } from '../lib/store';
  import { SearchSeq, sameStation, classifyRoutes, type RouteOutcome } from '../lib/marking';
  import Pill from '../components/Pill.svelte';
  import { sameModel, collectionFold, foldPreview, resolveModel, modelByFold } from '../lib/train-models';
  import { suggestModels } from '../lib/model-suggest';
  import { markMode, toast, goToTab, collectionSheetRequest } from '../lib/ui';
  import { tokens } from '../design/tokens';
  import type { RailGeoPackage, RailLine, RouteCandidate } from '../contract/types';
  import {
    buildBaseStyle,
    buildSegmentCollection,
    buildStationCollection,
    networkBounds,
    riddenBounds,
    litStationIds,
    lineOpacityExpression,
    lineWidthExpression,
    glowWidthExpression,
    braidGlowOpacityExpression,
    glowOffsetExpression,
    corridorPartnerLit,
    lineSortKeyExpression,
    lineOffsetExpression,
    stationColorExpression,
    stationRadiusExpression,
    selectedLineSegmentIds,
    selectedLineStationIds,
    inFilter,
    lodFilter,
    DEFAULT_LINE_COLOR,
    SEGMENTS_LAYER,
    SEGMENTS_SOURCE,
    STATIONS_SOURCE,
    SEGMENTS_GLOW_LAYER,
    STATIONS_LAYER,
    SELECTION_CASING_LAYER,
    HIGHLIGHT_STATION_LAYER,
  } from '../lib/map/style';
  import {
    allSegmentMidpoints,
    buildFloodPlan,
    diffNewlyLit,
    prefersReducedMotion,
    runFlood,
    MIN_WAVE_SIZE,
    type SegPoint,
  } from '../lib/map/flood';
  import { buildSearchIndex, resolveQuery, bilingualLabel, type StationHit } from '../lib/search';
  import { buildPopupModel, popupHtml } from '../lib/map/popup';
  import { companyFor } from '../lib/company';
  import { exposeE2EHandle, clearE2EHandle, e2eEnabled } from '../lib/map/e2e';
  import { loadBasemap } from '../lib/map/basemap';
  import { assetUrl } from '../lib/asset-url';

  // maplibre types are TYPE-ONLY imports — erased at compile time (verbatimModuleSyntax +
  // isolatedModules), so they do NOT violate the "never statically import maplibre" rule above:
  // that rule bans a side-effectful VALUE load of the WebGL library, which still happens lazily in
  // onMount via `await import(...)`. `Map` is aliased so it does not shadow the JS built-in Map.
  import type { Map as MapLibreMap, Popup as MapLibrePopup, FilterSpecification, GeoJSONSource } from 'maplibre-gl';
  type MapLib = typeof import('maplibre-gl');
  let map: MapLibreMap | null = null;
  let mapLib: MapLib | null = null;
  let popup: MapLibrePopup | null = null; // C5 reusable bilingual hover/selection popup

  let container: HTMLDivElement;
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let styleLoaded = false;
  let readyFallbackTimer: number | null = null; // window.setTimeout id (number, not Node's Timeout)

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
  const searchSeq = new SearchSeq(); // guards out-of-order async resolves (latest query wins)

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
    pickerCountry = null;
    resetSearch();
  }

  // Chips v3 (plausibility gate): fold-deduped recents ranked line-aware from the user's OWN
  // history, padded from the selected line's fact-checked service profile — all inside the
  // pure model-suggest lib (line-profiles.ts holds the data; the no-context v2 behavior stays
  // pinned in model-suggest.test.ts). Zero chips is a legitimate state now: unprofiled lines
  // show the honest free-text hint instead of implausible pads.
  const modelSuggestions = $derived.by(() =>
    suggestModels($events, {
      lineId: selectedLine?.lineId,
      lineOfSegment: (sid) => $geo.segmentById.get(sid)?.lineId,
      contexts: selectedLine
        ? [{ lineId: selectedLine.lineId, country: selectedLine.country, isHSR: selectedLine.isHSR }]
        : undefined,
      max: 8,
    }),
  );

  // D15: live canonical preview (feedback, not validation — free text is always accepted).
  // foldPreview is SHARED with the diary editor so the two input surfaces behave identically.
  const markModelPreview = $derived(foldPreview(markTrainModel));

  // ── first-collect reward beat (D14/DD4) + milestone celebration (D11/DD6) ──

  /** ONE definition of "is this mark collecting a new model?" — shared by both mark paths
   *  (was copy-pasted; the two must stay in lockstep or the beat fires inconsistently). */
  function newModelInfo(raw: string): { fold: string; isNew: boolean } {
    const fold = collectionFold(raw);
    return { fold, isNew: fold !== '' && !get(collectedModelKeys).has(fold) };
  }

  /** ` · 新幹線 8/13` — ONLY when this model itself counts toward its section's meter.
   *  D6 honesty (review finding): an inactive E3 or a non-corridor CN model sits in a
   *  metered section without ticking the meter — suffixing its toast with 0/N would be
   *  misleading, so those get no suffix at all. */
  function meterSuffix(fold: string): string {
    const entry = modelByFold(fold);
    if (!entry?.active) return '';
    if (entry.category === 'cn-hsr' && entry.corridor !== 'jinghu') return '';
    for (const section of get(collection).sections) {
      if (section.category === entry.category && section.meter) {
        return ` · ${section.meter.label} ${section.meter.collected}/${section.meter.total}`;
      }
    }
    return '';
  }

  /** DD4: tap-through target — the 図鑑 sheet on the stats tab, opened at the new card. */
  function openDex(fold: string | undefined): void {
    collectionSheetRequest.set({ fold });
    goToTab('stats');
  }

  /**
   * The success toast for a mark (one toast, never a stack): a first-collect beat replaces the
   * plain coverage message (undo stays as the action, the body taps through to the 図鑑 —
   * DD4), and freshly-crossed milestones follow as ONE extra beat (celebrated at most once
   * per device, ever — 6A).
   */
  function rewardToast(opts: {
    isNewModel: boolean;
    fold: string;
    modelRaw: string;
    fallback: string;
    undo: { label: string; fn: () => void };
  }): void {
    if (opts.isNewModel) {
      const label = resolveModel(opts.modelRaw)?.name ?? opts.fold;
      toast(
        `${label}を図鑑に追加しました${meterSuffix(opts.fold)}`,
        'success',
        6000,
        opts.undo,
        () => openDex(opts.fold),
      );
    } else {
      toast(opts.fallback, 'success', 6000, opts.undo);
    }
    void (async () => {
      const fresh = await celebrateNewMilestones();
      if (fresh.length > 0) {
        toast(
          `${fresh.map((m) => m.label).join('・')} を達成しました`,
          'success',
          6000,
          undefined,
          () => openDex(opts.fold || undefined),
        );
      }
    })();
  }

  function resetSearch(): void {
    cancelPendingResolves(); // a queued debounce must not repopulate hits after a reset
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

  // The picker is Japan-first, but China must be reachable in one tap — not buried under 594 JP
  // lines. A segmented country filter (shown only when >1 country is loaded) defaults to the first
  // country (JP) and scopes the list to the selected one.
  let pickerCountry = $state<string | null>(null);
  const activeCountry = $derived(pickerCountry ?? lineGroups[0]?.country ?? 'JP');
  const activeLines = $derived(lineGroups.find((g) => g.country === activeCountry)?.lines ?? []);
  const countryLabel = (c: string): string => (c === 'JP' ? '日本' : c === 'CN' ? '中国' : c);

  // segment midpoints for the flood sweep — recomputed only when packages change.
  let midpoints = new Map<string, SegPoint>();
  let prevLit: string[] = [];
  let cancelFlood: (() => void) | null = null;
  let floodInFlight = false; // a live wave — its cancel must never be followed by a paint skip
  // The packages ARRAY IDENTITY the map's sources were last built/setData'd from, and the lit
  // array the style's paint channels were last settled to. Both exist to reconcile the ASYNC
  // BOOT WINDOW (and later store swaps): the style is baked from a snapshot in onMount, and any
  // store emission before styleLoaded flips would otherwise leave the map stale forever.
  let builtPackages: RailGeoPackage[] | null = null;
  let styleLit: string[] = [];
  const sameLit = (a: string[], b: string[]): boolean =>
    a.length === b.length && a.every((id, i) => id === b[i]);

  onMount(() => {
    let disposed = false;
    (async () => {
      try {
        mapLib = await import('maplibre-gl');
        await import('maplibre-gl/dist/maplibre-gl.css');
        if (disposed) return;
        const pkgs = get(packages);
        midpoints = allSegmentMidpoints(pkgs);

        const initialLit = get(litSegmentIds);
        prevLit = initialLit;
        // Vendored same-origin vector basemap (OpenFreeMap positron); null offline/on failure —
        // the style then renders rail over a plain background, exactly like the old raster's
        // failure mode. Loaded before Map construction so the style ships complete in one shot.
        // Under ?e2e the basemap is SKIPPED on purpose: the harness readiness gate polls
        // map.loaded(), which stays false while third-party tiles stream — a slow tile origin
        // would hang every spec. The suite asserts rail layers only, and the basemap-less boot
        // is the same code path as the offline fallback, so e2e stays deterministic + offline.
        const basemap = e2eEnabled() ? null : await loadBasemap();
        if (disposed) return;
        const style = buildBaseStyle({ packages: pkgs, litSegmentIds: initialLit, basemap });
        builtPackages = pkgs;
        styleLit = initialLit;

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
          fadeDuration: prefersReducedMotion() ? 0 : 200,
        });
        map.touchZoomRotate?.disableRotation?.();
        exposeE2EHandle(map);

        // Readiness is idempotent: reached via maplibre's 'load' (the normal path) OR the
        // bounded fallback below when a hanging basemap origin delays 'load' indefinitely.
        const becomeReady = (): void => {
          if (disposed || status === 'ready' || !map) return;
          styleLoaded = true;
          // Boot-window reconcile. The style above was baked from snapshots (pkgs/initialLit),
          // and `await loadBasemap` can take seconds — a packages swap (fallback-retry self-heal)
          // or a litSegmentIds emission in that window hit effects that early-return on
          // !styleLoaded, so nothing would ever repaint. Catch both up to the CURRENT store
          // truth exactly once, here, before first paint is visible.
          syncSourcesToPackages(get(packages));
          const litNow = get(litSegmentIds);
          if (litNow !== styleLit && !sameLit(litNow, styleLit)) {
            // no wave for boot-window catch-up: the map was never seen in the stale state.
            repaint(litNow);
            applySortKey(litNow);
            styleLit = litNow;
          }
          // prevLit tracks litNow already (the lit effect updates it even pre-style), but align
          // explicitly so the equal-length no-op skip stays sound whatever the emission order was.
          prevLit = litNow;
          fitToNetwork();
          wireStationClicks();
          void surfaceLogoCredits();
          status = 'ready';
        };
        map.on('load', becomeReady);
        // A stalled tiles.openfreemap.org (throttled/blocked routes — mainland China) keeps
        // map.loaded() false for the whole network timeout, but the rail sources are same-origin
        // GeoJSON and usable within moments. Poll briefly: once the rail source is loaded and
        // 'load' still hasn't fired, become ready anyway — tiles keep streaming in behind.
        let readyPolls = 0;
        const pollReady = (): void => {
          if (disposed || status === 'ready' || !map) return;
          try {
            if (map.getSource(SEGMENTS_SOURCE) && map.isSourceLoaded(SEGMENTS_SOURCE)) {
              becomeReady();
              return;
            }
          } catch {
            /* style not ready yet — keep polling */
          }
          if (++readyPolls < 12) readyFallbackTimer = window.setTimeout(pollReady, 2000);
        };
        readyFallbackTimer = window.setTimeout(pollReady, 8000);

        // Which sources belong to the basemap — their failures must never take the app down
        // (rail is same-origin; the basemap is progressive decoration).
        const basemapSourceIds = new Set(Object.keys(basemap?.sources ?? {}));
        map.on('error', (e: unknown) => {
          const ev = e as { sourceId?: string; error?: { url?: string; message?: string } };
          const url = ev?.error?.url ?? '';
          const msg = String(ev?.error?.message ?? '');
          if ((ev?.sourceId && basemapSourceIds.has(ev.sourceId)) || url.includes('openfreemap') || msg.includes('openfreemap')) {
            // Offline/blocked basemap origin: expected degradation, log-and-continue. The style's
            // JSON is precached, so its TileJSON/tile fetches failing offline is the NORMAL path.
            console.warn('[MapView] basemap source unavailable (rail unaffected):', msg || url || e);
            return;
          }
          // GL/style errors after load shouldn't blank the map; only fail before ready.
          if (status !== 'ready') {
            console.error('[MapView] maplibre error:', ev?.error?.message ?? ev?.error ?? e);
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
      if (readyFallbackTimer !== null) clearTimeout(readyFallbackTimer);
      cancelPendingResolves();
      cancelFlood?.();
      popup?.remove?.();
      popup = null;
      map?.remove?.();
      map = null;
      clearE2EHandle();
    };
  });

  // The QA-only ?e2e window hook (window.__map / __mapReady) lives in lib/map/e2e.ts.

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
    // DD4: both braid-aware — opacity carries the glowShare split, offset re-centers a corridor
    // strand's glow onto the true geometry once ALL its partners are ridden (merged corridor
    // halo). The partner checks embed only the CORRIDOR-partner subset of the lit set — a closed
    // small set — so per-feature membership scans stay O(corridors), not O(|lit|), per frame.
    const corridorLit = corridorPartnerLit(lit, get(packages));
    map.setPaintProperty(SEGMENTS_GLOW_LAYER, 'line-opacity', braidGlowOpacityExpression(lit, corridorLit));
    map.setPaintProperty(SEGMENTS_GLOW_LAYER, 'line-offset', glowOffsetExpression(corridorLit));
    // A RIDDEN partner renders at every zoom (lodFilter always-on), so it must hold the braid
    // OPEN below partnersMinz — the offset is lit-keyed and re-set alongside the other channels.
    map.setPaintProperty(SEGMENTS_LAYER, 'line-offset', lineOffsetExpression(corridorLit));
    map.setPaintProperty(SELECTION_CASING_LAYER, 'line-offset', lineOffsetExpression(corridorLit));
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
    map.setFilter(SEGMENTS_LAYER, lodFilter('segmentId', lit, selSeg) as FilterSpecification);
    map.setFilter(STATIONS_LAYER, lodFilter('stationId', litStations, selSt) as FilterSpecification);
  }

  // 1A SETTLE-ONLY stacking order. `line-sort-key` is a MapLibre LAYOUT property, so re-setting it
  // re-tiles ALL 9,442 segments — orders of magnitude costlier than the paint/filter updates in
  // repaint(). The flood wave calls repaint() up to 48× per mark, so this MUST NEVER run per frame:
  // we re-apply it exactly ONCE, when the lit set has SETTLED to its final truth (the plain-repaint
  // path, and the flood's LAST frame only). It keeps ridden lines painted above unridden as the lit
  // set changes. Guards mirror repaint()'s so a call before the style is live is a harmless no-op.
  function applySortKey(lit: string[]): void {
    if (!map || !styleLoaded) return;
    map.setLayoutProperty(SEGMENTS_LAYER, 'line-sort-key', lineSortKeyExpression(lit));
    // 15A/#3: the glow layer carries the same sort-key so glow stacking never drifts from bodies.
    map.setLayoutProperty(SEGMENTS_GLOW_LAYER, 'line-sort-key', lineSortKeyExpression(lit));
  }

  // Rebuild the map's data from a NEW packages array (identity-compared, so a repeat emission
  // of the same array is free). The style itself is only baked once in onMount; afterwards the
  // sources are swapped in-place via setData — same layers, same paint expressions. Called from
  // the $packages effect below AND from becomeReady (a swap during the async boot window fires
  // before styleLoaded, so the effect's guard eats it — becomeReady replays the current truth).
  // searchIndex derives from $geo (already reactive) and the style.ts caches are WeakMap-keyed
  // by the packages identity (auto-invalidate on swap) — neither needs touching here.
  function syncSourcesToPackages(pkgs: RailGeoPackage[]): void {
    if (!map || !styleLoaded || pkgs === builtPackages) return;
    builtPackages = pkgs;
    midpoints = allSegmentMidpoints(pkgs);
    (map.getSource(SEGMENTS_SOURCE) as GeoJSONSource | undefined)?.setData(
      buildSegmentCollection(pkgs) as never,
    );
    (map.getSource(STATIONS_SOURCE) as GeoJSONSource | undefined)?.setData(
      buildStationCollection(pkgs) as never,
    );
    // Re-derive every lit-keyed channel + LOD filter against the new features (segment/station
    // ids can change across a stub → real-network swap), and settle the stacking order once.
    const lit = get(litSegmentIds);
    repaint(lit);
    applySortKey(lit);
    styleLit = lit;
  }

  // React to a packages-store swap (fallback-retry self-heal on online/focus): without this the
  // map renders the 3-line stub all session while stats show the real network. The initial mount
  // already built from the current value — the identity guard in syncSourcesToPackages skips it.
  $effect(() => {
    const pkgs = $packages; // read synchronously so the dep registers even when the guard bails
    syncSourcesToPackages(pkgs);
  });

  // React to litSegmentIds changes: small/equal → snap; big grow → D5 flood wave.
  $effect(() => {
    const lit = $litSegmentIds;
    if (!map || !styleLoaded) {
      prevLit = lit;
      return;
    }
    const added = diffNewlyLit(prevLit, lit);
    const interruptedFlood = floodInFlight;
    cancelFlood?.();
    floodInFlight = false;
    if (added.length === 0) {
      // added empty ⇒ lit ⊆ prevLit, so equal length ⇔ the set didn't change (repeat mark,
      // removal of a still-covered trip). Skip the repaint AND the layout re-tile entirely —
      // applySortKey re-tiles all 9,442 segments and must not run on a designed no-op. BUT only
      // when this emission did not just CANCEL a live flood: prevLit already tracks the flood's
      // TARGET, so skipping after a mid-wave cancel would strand paint at an intermediate frame
      // (adversarial review) — fall through and settle instead.
      if (lit.length === prevLit.length && !interruptedFlood) {
        prevLit = lit;
        return;
      }
      // a removal (or an interrupted flood) — repaint to the final truth. This IS the settle:
      // the lit set is already final, so re-tile the stacking order once, right after the paint.
      repaint(lit);
      applySortKey(lit);
    } else {
      const plan = buildFloodPlan(prevLit, added, midpoints, {
        reducedMotion: prefersReducedMotion(),
      });
      // Re-tile the sort-key ONLY on the flood's last frame (isLast) — layout re-tiles all
      // segments, so it must not run on any of the ≤48 intermediate repaint() frames. runFlood
      // fires isLast=true on its final tick (and once, synchronously, for a snap/reduced-motion
      // plan), so `frameLit` there is already the settled lit set.
      floodInFlight = true;
      cancelFlood = runFlood(plan, (frameLit, _frame, isLast) => {
        repaint(frameLit);
        if (isLast) {
          applySortKey(frameLit);
          floodInFlight = false;
        }
      });
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
    map.setFilter(SELECTION_CASING_LAYER, inFilter('segmentId', segIds) as FilterSpecification);
    map.setFilter(HIGHLIGHT_STATION_LAYER, inFilter('stationId', stIds) as FilterSpecification);
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
    if (busy) return; // re-entry guard: a double-tap can't append two trips for one slice
    if (!selectedLine) return;
    const pkg = get(packages).find((p) => p.lines.some((l) => l.lineId === selectedLine!.lineId));
    if (!pkg) {
      toast('地図の読み込みに失敗', 'error');
      return;
    }
    busy = true;
    try {
      const before = new Set(get(litSegmentIds));
      // D14: capture BEFORE the mark whether this model is new to the collection — after the
      // write the derived set already contains it.
      const modelRaw = markTrainModel.trim();
      const { fold: modelFold, isNew: isNewModel } = newModelInfo(modelRaw);
      const res = await markRide({
        lineId: selectedLine.lineId,
        fromStationId: from,
        toStationId: to,
        pkg,
        trainModel: modelRaw || undefined,
      });
      if (res.sliceLength === 0) {
        toast('同じ駅が選ばれています', 'info');
        return;
      }
      // E1: every mark appends a new trip. "Newly lit" = the slice's segments not already
      // covered, so the coverage toast still reads as % gained; a full repeat says so plainly.
      const newlyLit = res.segmentIds.filter((id) => !before.has(id));
      // Undo rolls back exactly the trip just appended (markRide returns its tripId; removeTrip
      // deletes every event of that trip). Longer ttl so the undo is actually reachable.
      const undo = { label: '元に戻す', fn: () => void removeTrip(res.tripId) };
      const fallback =
        newlyLit.length === 0
          ? `もう一度記録しました（${res.sliceLength}区間）`
          : `区間を記録しました（+${newlyLit.length}区間 / +${kmOf(newlyLit).toFixed(1)} km）`;
      rewardToast({ isNewModel, fold: modelFold, modelRaw, fallback, undo });
      // A >= MIN_WAVE_SIZE grow takes the D5 flood path, which owns the glow layer's
      // line-opacity for its whole sweep — pulse's 120ms rewrites would fight the ~23ms wave
      // frames and its final repaint would snap the wave early. Pulse only on the small-mark
      // (snap) path; the wave IS the celebration for a big mark.
      if (newlyLit.length < MIN_WAVE_SIZE) pulse(res.segmentIds);
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
    const seq = searchSeq.next();
    const hits = await resolveQuery(raw, searchIndex);
    if (!searchSeq.isCurrent(seq)) return; // a newer keystroke superseded this resolve
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

  // Debounce the per-keystroke resolve: the fuzzy fallback scans every station instance, so
  // resolving on EVERY input event burns a full scan per character. 150ms trails the keystroke
  // burst; SearchSeq still guards out-of-order async resolves (the seq is taken when the resolve
  // actually FIRES, so a stale timer that slips through can never clobber a newer one). Timers
  // are PER FIELD so a fast A→B hop doesn't drop A's pending resolve, and they're cancelled on
  // reset/unmount/pick/Escape so a stale resolve can't repopulate a hit list after the fact.
  const SEARCH_DEBOUNCE_MS = 150;
  const searchTimers: Record<'A' | 'B', number | null> = { A: null, B: null };
  function scheduleResolve(which: 'A' | 'B', raw: string): void {
    cancelPendingResolve(which);
    searchTimers[which] = window.setTimeout(() => {
      searchTimers[which] = null;
      void resolveInto(which, raw);
    }, SEARCH_DEBOUNCE_MS);
  }
  function cancelPendingResolve(which: 'A' | 'B'): void {
    const t = searchTimers[which];
    if (t !== null) {
      window.clearTimeout(t);
      searchTimers[which] = null;
    }
  }
  function cancelPendingResolves(): void {
    cancelPendingResolve('A');
    cancelPendingResolve('B');
  }

  function onQueryA(e: Event): void {
    queryA = (e.target as HTMLInputElement).value;
    selectedLine = null;
    scheduleResolve('A', queryA);
  }
  function onQueryB(e: Event): void {
    queryB = (e.target as HTMLInputElement).value;
    selectedLine = null;
    scheduleResolve('B', queryB);
  }

  // Enter selects the FIRST hit (same as clicking the top `.hit`); Escape clears this field's
  // query — or, if it's already empty, exits search/mark mode cleanly. Keeps the oninput-driven
  // search intact; we only intercept these two keys.
  function onSearchKey(which: 'A' | 'B', e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      const hits = which === 'A' ? hitsA : hitsB;
      if (hits.length > 0) {
        e.preventDefault();
        pickHit(which, hits[0]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const query = which === 'A' ? queryA : queryB;
      if (query) {
        // clear just this field's query + its hit list (and its queued resolve, which would
        // otherwise fire ~150ms later with the pre-Escape text); nothing else changes.
        cancelPendingResolve(which);
        if (which === 'A') {
          queryA = '';
          hitsA = [];
        } else {
          queryB = '';
          hitsB = [];
        }
        selectedLine = null;
      } else {
        // already empty — exit mark mode (resetMarking() runs off the markMode subscription).
        markMode.set(false);
      }
    }
  }

  function pickHit(which: 'A' | 'B', hit: StationHit): void {
    // A pick within the debounce window must win: the queued resolve would null the pick out.
    cancelPendingResolve(which);
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
    if (sameStation(a, b)) {
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
      return; // a newer pick superseded this one (object-identity guard; e2e-covered)
    }
    let outcome: RouteOutcome;
    try {
      // classifyRoutes wraps findRoutes + preferPickedLine + the length branching (pure, unit-tested).
      outcome = classifyRoutes(pkg, a, b);
    } finally {
      searching = false;
    }
    if (outcome.kind === 'no-route') {
      noRoute = true; // warm no-route state with a leg-by-leg fallback
    } else if (outcome.kind === 'single') {
      void commitRoute(outcome.route);
    } else {
      routeChoices = outcome.routes; // ≥2 candidates — show the route-picker
    }
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
      const modelRaw = markTrainModel.trim();
      const { fold: modelFold, isNew: isNewModel } = newModelInfo(modelRaw);
      const res = await markRoute(r, { trainModel: modelRaw || undefined });
      // E1: the route is always recorded as a new trip. Report newly-lit coverage; a full
      // repeat (every leg already ridden) says so instead of dead-ending.
      const newlyLit = r.segmentIds.filter((id) => !before.has(id));
      // Undo rolls back exactly the trip just appended (markRoute returns its tripId). Longer ttl.
      const undo = { label: '元に戻す', fn: () => void removeTrip(res.tripId) };
      const fallback =
        newlyLit.length === 0
          ? `もう一度記録しました（${r.segmentIds.length}区間 / ${res.totalKm.toFixed(1)} km）`
          : `経路を記録しました（+${newlyLit.length}区間 / +${kmOf(newlyLit).toFixed(1)} km）`;
      rewardToast({ isNewModel, fold: modelFold, modelRaw, fallback, undo });
      // Same wave/pulse exclusivity as doMark: a big grow floods, a small one pulses.
      if (newlyLit.length < MIN_WAVE_SIZE) pulse(r.segmentIds);
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
  // flash brighter. Gated by prefers-reduced-motion, and by floodInFlight: callers already
  // route big marks to the wave instead, but an unrelated in-flight wave (e.g. an import
  // landing mid-mark) must not have its glow opacity stomped by these 120ms rewrites either.
  function pulse(ids: string[]): void {
    if (!map || !styleLoaded || floodInFlight || prefersReducedMotion() || ids.length === 0) return;
    const pulsed = ['in', ['get', 'segmentId'], ['literal', ids]];
    const steadyLit = get(litSegmentIds);
    const steady = braidGlowOpacityExpression(steadyLit, corridorPartnerLit(steadyLit, get(packages)));
    let t = 0;
    const steps = 6;
    const beat = (): void => {
      // A wave that starts MID-pulse takes over the glow layer: bail without a restore —
      // the flood repaints every frame, so it immediately owns line-opacity from here.
      if (!map || !styleLoaded || floodInFlight) return;
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
    <img class="line-logo" src={assetUrl(line.logo)} alt="" loading="lazy" />
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
          {#if lineGroups.length > 1}
            <div class="country-tabs" role="tablist" aria-label="国で絞り込み">
              {#each lineGroups as group (group.country)}
                <button
                  class="country-tab"
                  class:active={activeCountry === group.country}
                  role="tab"
                  aria-selected={activeCountry === group.country}
                  onclick={() => (pickerCountry = group.country)}
                >{countryLabel(group.country)}</button>
              {/each}
            </div>
          {/if}
          <div class="line-list">
            {#each activeLines as line (line.lineId)}
              <button class="line-chip" onclick={() => pickLine(line)}>
                {@render companyTag(line)}
                {@render lineMark(line)}
                <span class="line-name" title={bilingualLabel(line.name, line.nameRoma)}>{bilingualLabel(line.name, line.nameRoma)}</span>
                {#if line.isHSR}<span class="hsr">新幹線</span>{/if}
              </button>
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
              onkeydown={(e) => onSearchKey('A', e)}
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
            {:else if queryA.trim()}
              <!-- typed but zero matches — distinct from the neutral not-yet-typed empty state. -->
              <p class="no-hit" role="status">該当する駅が見つかりません</p>
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
              onkeydown={(e) => onSearchKey('B', e)}
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
            {:else if queryB.trim()}
              <!-- typed but zero matches — distinct from the neutral not-yet-typed empty state. -->
              <p class="no-hit" role="status">該当する駅が見つかりません</p>
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
          {#if markModelPreview !== null}
            <!-- D15: feedback, not validation — shows what the fold will record -->
            <p class="train-preview u-muted">→ {markModelPreview} として記録</p>
          {/if}
          {#if modelSuggestions.length > 0}
            <div class="train-chips" role="group" aria-label="車両の候補">
              {#each modelSuggestions as m (m)}
                <!-- 5A: highlight by FOLD so typed 'E5系' lights the E5 chip (preview and chip agree) -->
                <Pill
                  active={sameModel(markTrainModel, m)}
                  onclick={() => (markTrainModel = sameModel(markTrainModel, m) ? '' : m)}
                >{m}</Pill>
              {/each}
            </div>
          {:else}
            <!-- Honest empty state (v3 gate): an unprofiled line pads nothing — free text
                 is the capture path, and suggestions never pretend to be eligibility. -->
            <p class="train-preview u-muted">この路線の候補は未収録です。自由入力で記録できます。</p>
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
  /* Country filter — one tap to China so the corridor isn't buried under 594 JP lines. */
  .country-tabs {
    display: flex;
    gap: var(--space-xs);
    margin-bottom: var(--space-sm);
  }
  .country-tab {
    flex: 1;
    min-height: 40px;
    padding: 0 var(--space-md);
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-button);
    background: var(--white);
    color: var(--ink-muted);
    font-size: var(--size-label);
    font-weight: var(--weight-label);
    cursor: pointer;
  }
  .country-tab.active {
    background: var(--rail-text);
    color: var(--white);
    border-color: var(--rail-text);
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
  .train-preview {
    margin: 4px 0 0;
    font-size: var(--size-label);
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
  /* Typed-but-no-match notice — muted, distinct from the neutral not-yet-typed empty state. */
  .no-hit {
    margin: var(--space-xs) 0 0;
    font-size: var(--size-label);
    color: var(--ink-muted);
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
