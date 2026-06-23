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
  import { packages, litSegmentIds, geo, markRide } from '../lib/store';
  import { markMode, toast } from '../lib/ui';
  import { tokens } from '../design/tokens';
  import type { RailLine } from '../contract/types';
  import {
    buildBaseStyle,
    networkBounds,
    litStationIds,
    lineColorExpression,
    lineWidthExpression,
    glowWidthExpression,
    glowOpacityExpression,
    stationColorExpression,
    stationRadiusExpression,
    SEGMENTS_LAYER,
    SEGMENTS_GLOW_LAYER,
    STATIONS_LAYER,
  } from '../lib/map/style';
  import {
    segmentMidpoints,
    buildFloodPlan,
    diffNewlyLit,
    prefersReducedMotion,
    runFlood,
    type SegPoint,
  } from '../lib/map/flood';

  // Loaded lazily so the module-eval is browser-free.
  type MapLib = typeof import('maplibre-gl');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let map: any = null;
  let mapLib: MapLib | null = null;

  let container: HTMLDivElement;
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let styleLoaded = false;

  // ── marking state (line-first: pick line → tap A → tap B) ───────────────────
  let selectedLine = $state<RailLine | null>(null);
  let stationA = $state<string | null>(null);
  let stationAName = $state<string | null>(null);
  let busy = $state(false);

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
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          // JP focus default; fitBounds overrides once style is ready.
          center: [138, 37],
          zoom: 4,
          // self-contained: no remote glyphs/tiles requested.
          fadeDuration: prefersReducedMotion() ? 0 : 200,
        });
        map.touchZoomRotate?.disableRotation?.();

        map.on('load', () => {
          if (disposed) return;
          styleLoaded = true;
          fitToNetwork();
          wireStationClicks();
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
      map?.remove?.();
      map = null;
    };
  });

  function fitToNetwork(): void {
    const b = networkBounds(get(packages));
    if (!b || !map) return;
    map.fitBounds(b, { padding: 56, duration: 0, maxZoom: 12 });
  }

  function wireStationClicks(): void {
    if (!map) return;
    map.on('click', STATIONS_LAYER, (e: { features?: { properties: Record<string, unknown> }[] }) => {
      const feats = e.features ?? [];
      if (feats.length === 0) return;
      // A transfer station (e.g. 渋谷) is several coincident features, one per line. When a
      // line is picked, prefer the feature ON that line so the tap isn't wrongly rejected.
      const match = selectedLine
        ? feats.find((ft) => String(ft.properties.lineId) === selectedLine!.lineId)
        : undefined;
      const f = match ?? feats[0];
      onStationTap(String(f.properties.stationId), String(f.properties.name), String(f.properties.lineId));
    });
    map.on('mouseenter', STATIONS_LAYER, () => {
      if (markActive && map) map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', STATIONS_LAYER, () => {
      if (map) map.getCanvas().style.cursor = '';
    });
  }

  // ── lit-set → paint updates (single data-driven expression, setPaintProperty) ──
  function repaint(lit: string[]): void {
    if (!map || !styleLoaded) return;
    const litStations = litStationIds(lit, get(packages));
    map.setPaintProperty(SEGMENTS_LAYER, 'line-color', lineColorExpression(lit));
    map.setPaintProperty(SEGMENTS_LAYER, 'line-width', lineWidthExpression(lit));
    map.setPaintProperty(SEGMENTS_GLOW_LAYER, 'line-width', glowWidthExpression(lit));
    map.setPaintProperty(SEGMENTS_GLOW_LAYER, 'line-opacity', glowOpacityExpression(lit));
    map.setPaintProperty(STATIONS_LAYER, 'circle-color', stationColorExpression(litStations));
    map.setPaintProperty(STATIONS_LAYER, 'circle-radius', stationRadiusExpression(litStations));
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
      const res = await markRide({
        lineId: selectedLine.lineId,
        fromStationId: from,
        toStationId: to,
        pkg,
      });
      if (res.added === 0) {
        toast('この区間は記録済み', 'info');
      } else {
        // Count km over the NEWLY-lit segments only, so the number agrees with "+N区間".
        const km = kmForSegments(res.addedSegmentIds, pkg);
        toast(`区間を記録しました（+${res.added}区間 / +${km.toFixed(1)} km）`, 'success');
        pulse(res.addedSegmentIds);
        markMode.set(false); // exit mark mode after a successful mark
      }
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

  function kmForSegments(ids: string[], pkg: { segments: { segmentId: string; km: number }[] }): number {
    const byId = new Map(pkg.segments.map((s) => [s.segmentId, s.km]));
    return ids.reduce((sum, id) => sum + (byId.get(id) ?? 0), 0);
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
</script>

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
    <!-- Line-first marking (DESIGN issue 5). -->
    <div class="mark-panel" role="group" aria-label="区間をマーク">
      {#if !selectedLine}
        <p class="mark-title">路線を選択</p>
        <div class="line-list">
          {#each lineGroups as group (group.country)}
            {#each group.lines as line (line.lineId)}
              <button class="line-chip" onclick={() => pickLine(line)}>
                <span class="dot" aria-hidden="true"></span>
                <span class="line-name">{line.name}</span>
                {#if line.isHSR}<span class="hsr">新幹線</span>{/if}
              </button>
            {/each}
          {/each}
        </div>
      {:else}
        <div class="mark-step">
          <button class="back" onclick={backToLinePicker} aria-label="路線選択に戻る">‹</button>
          <span class="picked">{selectedLine.name}{#if selectedLine.isHSR}<span class="hsr">新幹線</span>{/if}</span>
        </div>
        <p class="mark-hint" aria-live="polite">
          {#if !stationA}
            地図上で<strong>出発駅</strong>をタップ
          {:else}
            <strong>{stationAName}</strong> から<strong>到着駅</strong>をタップ
          {/if}
        </p>
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
  .line-chip .dot {
    width: 10px;
    height: 10px;
    border-radius: var(--radius-pill);
    background: var(--rail-lit);
    flex: none;
  }
  .line-name {
    flex: 1;
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

  @media (prefers-reduced-motion: reduce) {
    .skeleton svg {
      animation: none;
      opacity: 0.7;
    }
  }
</style>
