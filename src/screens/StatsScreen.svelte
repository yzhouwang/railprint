<script lang="ts">
  // T8 — the full stats view + the Wrapped <canvas> share card entry point.
  //
  // Reads coverage from the store (headline + per-package coverages + the geo index) and
  // renders: the completion StatCards (全国 + 新幹線), the superlatives ("your year in
  // rail"), the prefecture count, and the "Wrapped を作成" button that eagerly renders a
  // share image then hands it to share.ts. Works in both the 380px desktop side panel and
  // full-screen mobile. Empty/zero state degrades gracefully (no NaN).
  import { get } from 'svelte/store';
  import CountryStatCards from '../components/CountryStatCards.svelte';
  import FolderTabCard from '../components/FolderTabCard.svelte';
  import Button from '../components/Button.svelte';
  import Pill from '../components/Pill.svelte';
  import Diorama from '../components/Diorama.svelte';
  import QuarantineCard from '../components/QuarantineCard.svelte';
  import QuarantineSheet from '../components/QuarantineSheet.svelte';
  import CollectionSheet from '../components/CollectionSheet.svelte';
  import TrainSilhouette from '../components/TrainSilhouette.svelte';
  import { silhouetteAsset } from '../lib/silhouettes';
  import ProgressBar from '../components/ProgressBar.svelte';
  import {
    headline,
    coverages,
    geo,
    events,
    packages,
    orphanCount,
    closedLineKm,
    closedLineCount,
    setTripTrainModel,
    restoreEvents,
    collection,
  } from '../lib/store';
  import { canonicalizeTrainModel, sameModel, collectionFold, foldPreview, resolveModel } from '../lib/train-models';
  import { suggestModels, lineContexts, NO_PROFILE_HINT, NO_PROFILE_HINT_MULTI } from '../lib/model-suggest';
  import type { RideEvent } from '../contract/types';

  // Phase 4 — the quarantine review sheet opens from the QuarantineCard below the coverage cards.
  let quarantineOpen = $state(false);
  import { summarizeDiary } from '../lib/trips';
  import { toast, dismissToast, collectionSheetRequest } from '../lib/ui';

  // ── 車両図鑑 (v0.13) — the DD1 single-job shelf + the sheet it opens ──
  let dexOpen = $state(false);
  let dexInitialFold = $state<string | undefined>(undefined);
  let dexShelfEl: HTMLButtonElement | undefined = $state();

  function openDexSheet(fold: string | undefined): void {
    dexInitialFold = fold;
    dexOpen = true;
  }
  function closeDexSheet(): void {
    dexOpen = false;
    dexInitialFold = undefined;
    dexShelfEl?.focus(); // DD13: focus returns to the opener
  }

  // DD4 deep-link consumer: the first-collect toast (map tab) requests the sheet; consume the
  // request whenever this screen is mounted (mobile mounts stats AFTER goToTab, so this effect
  // is the reliable rendezvous, not a direct call).
  $effect(() => {
    const req = $collectionSheetRequest;
    if (req) {
      collectionSheetRequest.set(null);
      openDexSheet(req.fold);
    }
  });

  /** Shelf hero meter: the first metered section the user has progress in (CN-only riders get
   *  the 京沪 meter instead of a dispiriting JP 0/13 — DD15). */
  const shelfMeter = $derived.by(() => {
    const metered = $collection.sections.filter((s) => s.meter);
    return metered.find((s) => s.meter!.collected > 0)?.meter;
  });
  /** Three most recently ridden collected models — the shelf's mini-silhouette strip. */
  const shelfRecent = $derived.by(() =>
    $collection.sections
      .flatMap((s) => s.collected)
      .sort((a, b) => (b.lastRidden ?? '').localeCompare(a.lastRidden ?? ''))
      .slice(0, 3),
  );
  import { buildWrappedData, renderWrappedBlobSync } from '../lib/wrapped/card';
  import { ensureWrappedFonts } from '../lib/wrapped/font';
  import { shareCard } from '../lib/wrapped/share';

  // Derive the resolved superlatives from the SAME pure shaper the canvas uses, so the
  // on-screen list and the exported card never drift.
  const wrapped = $derived(
    buildWrappedData({ headline: $headline, coverages: $coverages, geo: $geo, collection: $collection }),
  );

  // 旅の記録 — the journey diary (D2: date-led rows; a repeat ride is just another dated row,
  // never collapsed). Built from summarizeDiary over each loaded package's events, then sorted
  // newest-first. Endpoints + line/model names are resolved against the geo index here so the
  // pure trips lib stays geometry-faithful and name-free.
  /** One tappable diary pill = one FOLD-GROUP of the trip's rows (5A/13A: per-pill edit scope). */
  interface ModelPillGroup {
    fold: string;
    /** registry 形式 name when matched, else the most recent raw spelling (verbatim その他). */
    label: string;
    eventIds: string[];
  }
  interface DiaryRow {
    /** unique across packages (a tripId can repeat across JP/CN once China lands). */
    key: string;
    tripId: string;
    date?: string;
    from: string;
    to: string;
    km: number;
    segCount: number;
    lineLabel: string;
    /** ALL trip lineIds — the v3 plausibility gate takes every line the trip touches
     *  (eligible-in-ANY-context); [0] seeds the editor's line-aware chip ranking (D8). */
    lineIds: string[];
    modelGroups: ModelPillGroup[];
    /** rows with NO model — the ＋車両 target (13A: fills blanks only). */
    blankIds: string[];
    createdAt: string;
  }

  // trip bucket → its raw event rows, keyed exactly like trips.ts (tripId ?? solo:<id>) so the
  // editor can hand setTripTrainModel EVENT IDS (D7: never a country-prefixed diary key).
  const tripEventRows = $derived.by(() => {
    const buckets = new Map<string, RideEvent[]>();
    for (const ev of $events) {
      const key = ev.tripId ?? `solo:${ev.id}`;
      const list = buckets.get(key);
      if (list) list.push(ev);
      else buckets.set(key, [ev]);
    }
    return buckets;
  });

  // segmentId → owning country, across ALL loaded packages. Needed because tripIds can repeat
  // across JP/CN (the diary row key is country-prefixed for exactly this reason) — a bucket
  // keyed on bare tripId would leak the OTHER country's rows into this row's pills and, worse,
  // hand their event ids to setTripTrainModel (ship review P1). Unresolved segments (quarantine/
  // orphan/CN-404) belong to NO package and stay with every candidate row — D16 generosity.
  const segCountry = $derived.by(() => {
    const map = new Map<string, string>();
    for (const p of $packages) for (const seg of p.segments) map.set(seg.segmentId, p.country);
    return map;
  });

  const diaryRows = $derived.by(() => {
    const idx = $geo;
    const stationName = (id: string) => idx.stationById.get(id)?.name ?? '?';
    const rows: DiaryRow[] = [];
    for (const { pkg } of $coverages) {
      for (const t of summarizeDiary($events, pkg).trips) {
        const lineNames: string[] = [];
        for (const id of t.lineIds) {
          const n = idx.lineById.get(id)?.name;
          if (n) lineNames.push(n);
        }
        // Fold-dedupe the trip's models at RENDER (5A) — E5系 + e5 become ONE pill; stored
        // strings stay untouched (D4). Each pill carries the event ids of its fold-group.
        const groups = new Map<string, { label: string; labelAt: string; eventIds: string[] }>();
        const blankIds: string[] = [];
        for (const ev of tripEventRows.get(t.tripId) ?? []) {
          // Cross-package guard (ship review P1): only rows belonging to THIS package's trip —
          // or unresolved anywhere (D16) — may surface as pills / edit targets here.
          const owner = segCountry.get(ev.segmentId);
          if (owner !== undefined && owner !== pkg.country) continue;
          if (!ev.trainModel) {
            blankIds.push(ev.id);
            continue;
          }
          // Registry-resolved: two alias spellings of one card must be ONE pill, and the
          // per-pill edit scope must cover both (review finding, alias class).
          const fold = collectionFold(ev.trainModel);
          const g = groups.get(fold);
          if (g) {
            g.eventIds.push(ev.id);
            if (ev.createdAt > g.labelAt) {
              g.label = resolveModel(ev.trainModel)?.name ?? ev.trainModel;
              g.labelAt = ev.createdAt;
            }
          } else {
            groups.set(fold, {
              label: resolveModel(ev.trainModel)?.name ?? ev.trainModel,
              labelAt: ev.createdAt,
              eventIds: [ev.id],
            });
          }
        }
        rows.push({
          key: `${pkg.country}:${t.tripId}`,
          tripId: t.tripId,
          date: t.date,
          from: t.fromStationId ? stationName(t.fromStationId) : '?',
          to: t.toStationId ? stationName(t.toStationId) : '?',
          km: t.km,
          segCount: t.segmentIds.length,
          lineLabel: lineNames.length === 1 ? lineNames[0] : `${t.lineIds.length}路線`,
          lineIds: t.lineIds,
          modelGroups: [...groups.entries()].map(([fold, g]) => ({ fold, label: g.label, eventIds: g.eventIds })),
          blankIds,
          createdAt: t.createdAt,
        });
      }
    }
    // Newest journeys first (createdAt is the stable key; date may be absent on imports).
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows;
  });

  // ── 未記録 funnel (DD1/DD3): the enrichment badge lives HERE, next to where editing happens.
  let unrecordedOnly = $state(false);
  const unrecordedCount = $derived(diaryRows.filter((r) => r.modelGroups.length === 0).length);
  // Draining the LAST untagged trip while the filter is active must return the full diary,
  // not a blank list with the (now-hidden) toggle unreachable (review finding).
  $effect(() => {
    if (unrecordedCount === 0 && unrecordedOnly) unrecordedOnly = false;
  });
  const visibleDiaryRows = $derived(
    unrecordedOnly ? diaryRows.filter((r) => r.modelGroups.length === 0) : diaryRows,
  );

  // ── inline 車両 editor (DD5): ONE open editor at a time; per-pill scope; stale-undo
  //    invalidation (8A: a new edit dismisses this trip's earlier undo toast).
  let editing = $state<null | { key: string; fold: string | null; draft: string }>(null);
  let editBusy = $state(false);
  let editorReturnEl: HTMLElement | null = null;
  const lastEditToast = new Map<string, number>();

  const draftCanon = $derived(editing ? canonicalizeTrainModel(editing.draft) : '');
  const draftPreview = $derived(editing ? foldPreview(editing.draft) : null);

  // Memoized on (editing.key, events, geo) — reading editing.key alone means keystrokes on
  // editing.draft do NOT re-trigger this O(events) pass (ship review, perf).
  const editorChipList = $derived.by(() => {
    if (!editing) return [];
    const row = diaryRows.find((r) => r.key === editing!.key);
    if (!row) return [];
    const idx = $geo;
    // v3 gate: one context per resolvable trip line (eligible-in-ANY). Unresolvable lines
    // (quarantine/orphan imports) contribute nothing; zero contexts = KNOWN-EMPTY — the
    // gate stays on with recents-only + the honest hint, never the legacy CN-first pads
    // (outside-voice review round).
    return suggestModels($events, {
      lineId: row.lineIds[0],
      lineOfSegment: (sid) => idx.segmentById.get(sid)?.lineId,
      contexts: lineContexts(row.lineIds, (id) => idx.lineById.get(id)),
      max: 6,
    });
  });

  function openEditor(e: MouseEvent, row: DiaryRow, fold: string | null, current: string): void {
    if (editBusy) return;
    editorReturnEl = e.currentTarget as HTMLElement;
    editing = { key: row.key, fold, draft: current };
  }

  function closeEditor(): void {
    editing = null;
    editorReturnEl?.focus();
    editorReturnEl = null;
  }

  function autofocus(node: HTMLInputElement): void {
    node.focus();
  }

  async function saveEditor(row: DiaryRow): Promise<void> {
    if (!editing || editBusy) return; // busy guard (8A): a double-tap can't interleave writes
    const target =
      editing.fold === null
        ? row.blankIds
        : (row.modelGroups.find((g) => g.fold === editing!.fold)?.eventIds ?? []);
    if (target.length === 0) {
      closeEditor();
      return;
    }
    editBusy = true;
    try {
      const { prior, updated } = await setTripTrainModel(target, editing.draft);
      if (updated > 0) {
        // 8A: invalidate this trip's PREVIOUS undo toast — its snapshot is now stale and
        // restoring it would silently discard this newer edit.
        const prev = lastEditToast.get(row.key);
        if (prev !== undefined) dismissToast(prev);
        const label = draftCanon || '車両なし';
        const id = toast(`車両を「${label}」に更新しました`, 'success', 3200, {
          label: '元に戻す',
          fn: () => void restoreEvents(prior),
        });
        lastEditToast.set(row.key, id);
      }
      closeEditor();
    } finally {
      editBusy = false;
    }
  }

  // "2025-11-03" → "2025.11.03"; undated imports read 日付なし rather than an empty cell.
  const dateLabel = (d: string | undefined): string =>
    d ? d.replaceAll('-', '.') : '日付なし';

  let busy = $state(false);

  // Warm the webfont weights as soon as the screen mounts so the await inside
  // renderWrappedToBlob resolves on (or near) the same gesture tick (iOS tofu fix, D7).
  $effect(() => {
    void ensureWrappedFonts();
  });

  /**
   * iOS-gesture-safe share: fonts were warmed on mount, so we build the blob
   * SYNCHRONOUSLY here (renderWrappedBlobSync — no task boundary) and hand it straight to
   * shareCard, which calls navigator.share() before its first await. No await sits between
   * the tap and share(), so iOS Safari keeps the gesture's transient activation.
   */
  async function createWrapped(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      // Read store snapshots + render the blob synchronously inside the gesture.
      const data = buildWrappedData({
        headline: get(headline),
        coverages: get(coverages),
        geo: get(geo),
        collection: get(collection),
      });
      const blob = renderWrappedBlobSync(data);
      const outcome = await shareCard(blob, 'railprint-wrapped.png', {
        title: 'RailPrint',
        text: `乗った距離 ${Math.round(data.totalKm).toLocaleString()} km · 全国 ${data.stats[0].value}%`,
      });
      if (outcome === 'downloaded') toast('画像を保存しました', 'success');
      else if (outcome === 'shared') toast('シェアしました', 'success');
    } catch {
      toast('Wrapped カードの作成に失敗しました', 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="stats">
  <h1 class="title">統計</h1>

  <!-- Phase 4: the quarantine entry must survive an all-orphaned log (riddenKm 0 → !hasRides), so the
       stats body renders whenever there are rides OR orphans OR kept closed-line rides. The coverage
       cards, diary, and Wrapped still need real resolved rides, so they stay behind hasRides. -->
  {#if $headline.hasRides || $orphanCount > 0 || $closedLineCount > 0 || $collection.totalModels > 0}
    {#if $headline.hasRides}
      <CountryStatCards />
    {/if}

    <QuarantineCard onopen={() => (quarantineOpen = true)} />

    {#if $headline.hasRides || $closedLineCount > 0}
      <FolderTabCard label="記録">
        <div class="rows">
          {#if $headline.hasRides}
            <div class="row">
              <span class="u-label">都道府県・地域</span>
              <span class="rowval"><span class="num u-display">{$headline.prefectures}</span></span>
            </div>
          {/if}
          {#if $closedLineCount > 0}
            <!-- rides on now-abolished track, kept as history — a positive 廃線 stat, never a deduction. -->
            <div class="row">
              <span class="u-label">廃線</span>
              <span class="rowval">
                <span class="sval">{$closedLineKm.toLocaleString('ja-JP')} km</span>
                <span class="ssub u-emphasis">{$closedLineCount}区間</span>
              </span>
            </div>
          {/if}
          {#each $headline.hasRides ? wrapped.superlatives : [] as s (s.label)}
            <div class="row">
              <span class="u-label">{s.label}</span>
              <span class="rowval">
                <span class="sval">{s.value}</span>
                {#if s.sub}<span class="ssub u-emphasis">{s.sub}</span>{/if}
              </span>
            </div>
          {/each}
        </div>
      </FolderTabCard>
    {/if}

    {#if $headline.hasRides || $collection.totalModels > 0}
    <!-- DD1: the 車両図鑑 shelf — ONE job (show collection progress, invite one tap); the whole
         shelf is the button. 未記録 enrichment lives on the diary card below, not here.
         Gated on rides OR collected models (not hasRides alone): D16 keeps the collection
         alive through CN-404/quarantine/orphan states, so its shelf must survive them too
         (review finding). -->
    <button class="dex-shelf" bind:this={dexShelfEl} onclick={() => openDexSheet(undefined)}>
      <span class="dex-body">
        <span class="dex-title">
          車両図鑑
          {#if $collection.totalModels > 0}
            <span class="dex-sub u-muted">{$collection.totalModels}車両を記録</span>
          {/if}
        </span>
        {#if $collection.totalModels === 0}
          <span class="dex-invite u-muted">車両を記録すると図鑑が育ちます</span>
        {:else if shelfMeter}
          <span class="dex-meter">
            <span class="dex-meter-num">
              <span class="dex-big">{shelfMeter.collected}</span><span class="dex-den u-muted">/{shelfMeter.total}</span>
            </span>
            <span class="dex-meter-bar"><ProgressBar value={shelfMeter.total > 0 ? (shelfMeter.collected / shelfMeter.total) * 100 : 0} label={shelfMeter.label} /></span>
            <span class="dex-meter-label u-muted">{shelfMeter.label}</span>
          </span>
        {/if}
        {#if shelfRecent.length > 0}
          <span class="dex-minis" aria-hidden="true">
            {#each shelfRecent as s (s.fold)}
              <TrainSilhouette variant={s.info?.silhouette ?? 'commuter'} fill={s.info?.accentColor ?? 'var(--rail-lit)'} width={44} raster={silhouetteAsset(s.fold)} />
            {/each}
          </span>
        {/if}
      </span>
      <span class="dex-chevron u-muted" aria-hidden="true">›</span>
    </button>
    {/if}

    {#if $headline.hasRides}
    <FolderTabCard label="旅の記録">
      {#if unrecordedCount > 0}
        <!-- DD3: the 未記録 funnel — the toggle narrows the diary to model-less trips so
             draining the count is visible progress (each edit removes a row). -->
        <div class="diary-tools">
          <Pill active={unrecordedOnly} onclick={() => (unrecordedOnly = !unrecordedOnly)}>
            未記録のみ {unrecordedCount}
          </Pill>
        </div>
      {/if}
      {#if diaryRows.length > 0}
        <ul class="trips">
          {#each visibleDiaryRows as t (t.key)}
            <li class="trip">
              <div class="trip-head">
                <span class="trip-date">{dateLabel(t.date)}</span>
                <span class="trip-km u-muted">{t.km.toLocaleString()} km</span>
              </div>
              <div class="trip-route">
                {t.from} <span class="arrow u-muted" aria-hidden="true">→</span> {t.to}
              </div>
              <div class="trip-meta">
                <span class="u-muted">{t.lineLabel} · {t.segCount}区間</span>
                {#each t.modelGroups as g (g.fold)}
                  <!-- per-PILL edit scope (13A): this pill edits ONLY its fold-group's rows -->
                  <Pill variant="compact" onclick={(e) => openEditor(e, t, g.fold, g.label)}>{g.label}</Pill>
                {/each}
                {#if t.blankIds.length > 0}
                  <Pill variant="ghost-add" onclick={(e) => openEditor(e, t, null, '')}>＋車両</Pill>
                {/if}
              </div>
              {#if editing?.key === t.key}
                <!-- DD5: the inline expansion editor — capture and edit share one input language -->
                <div class="editor" role="group" aria-label="車両を編集">
                  <label class="editor-label u-label" for="dex-edit-input">車両</label>
                  <input
                    id="dex-edit-input"
                    class="editor-input"
                    type="text"
                    placeholder="例: N700S / E5系 / CR400AF"
                    autocomplete="off"
                    use:autofocus
                    bind:value={editing.draft}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') void saveEditor(t);
                      else if (e.key === 'Escape') closeEditor();
                    }}
                  />
                  {#if draftPreview !== null}
                    <p class="editor-preview u-muted">→ {draftPreview} として記録</p>
                  {/if}
                  {#if editorChipList.length > 0}
                    <div class="editor-chips">
                      {#each editorChipList as chip (chip)}
                        <Pill
                          active={editing !== null && sameModel(editing.draft, chip)}
                          onclick={() => {
                            if (editing) editing.draft = sameModel(editing.draft, chip) ? '' : chip;
                          }}
                        >{chip}</Pill>
                      {/each}
                    </div>
                  {:else if editing.draft.trim() === ''}
                    <!-- v3 gate honest empty state — shared constant with the map capture
                         field; yields to the fold preview once the user types; announced
                         (role="status") like the map's zero-result messages. -->
                    <p class="editor-preview u-muted" role="status">
                      {t.lineIds.length > 1 ? NO_PROFILE_HINT_MULTI : NO_PROFILE_HINT}
                    </p>
                  {/if}
                  <div class="editor-actions">
                    <button class="ebtn primary" type="button" disabled={editBusy} onclick={() => void saveEditor(t)}>
                      保存
                    </button>
                    <button class="ebtn" type="button" disabled={editBusy} onclick={closeEditor}>
                      キャンセル
                    </button>
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <div class="zero">
          <Diorama variant="board" width={140} label="まだ旅の記録がありません" />
          <p class="cta-copy u-muted">区間をマークすると、ここに旅がたまっていきます。</p>
        </div>
      {/if}
    </FolderTabCard>

    <FolderTabCard label="Wrapped">
      <div class="wrapped-cta">
        <Diorama variant="train" width={160} label="Wrapped カード" />
        <p class="cta-copy u-muted">
          今年の乗車をまとめたカードを画像にして、シェアできます。
        </p>
        <Button icon="share" full disabled={busy} onclick={createWrapped}>
          {busy ? '作成中…' : 'Wrapped を作成'}
        </Button>
      </div>
    </FolderTabCard>
    {/if}
  {:else}
    <!-- Zero state (desktop side-panel can land here; mobile routes to EmptyState). -->
    <FolderTabCard label="統計">
      <div class="zero">
        <Diorama variant="board" width={160} label="まだ記録がありません" />
        <p class="cta-copy u-muted">
          路線を記録すると、達成率と Wrapped カードがここに表示されます。
        </p>
        <Pill>0 km · 全国</Pill>
      </div>
    </FolderTabCard>
  {/if}
</div>

{#if quarantineOpen}
  <QuarantineSheet onclose={() => (quarantineOpen = false)} />
{/if}

{#if dexOpen}
  <CollectionSheet onclose={closeDexSheet} initialFold={dexInitialFold} />
{/if}

<style>
  .stats {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
    padding: var(--space-lg);
    max-width: 460px;
    margin: 0 auto;
  }
  .title {
    margin: var(--space-sm) 0 0;
    font-size: 22px;
    font-weight: var(--weight-display);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }
  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-md);
  }
  .rowval {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    min-width: 0;
    text-align: right;
  }
  .num {
    /* small inline display number — emerald-600 is allowed at ≥24px (DESIGN.md). */
    font-size: 26px;
  }
  .sval {
    font-weight: var(--weight-label);
    color: var(--ink);
    /* keep long station-pair strings from overflowing the narrow panel */
    overflow-wrap: anywhere;
  }
  .ssub {
    font-size: var(--size-label);
    white-space: nowrap;
  }
  .wrapped-cta,
  .zero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-md);
  }
  .cta-copy {
    margin: 0;
    font-size: var(--size-body);
    line-height: 1.6;
  }
  /* 旅の記録 — date-led journey rows; the date is the primary identifier so repeat rides
     read as two distinct dated trips, not a duplicate. Rows live in ONE folder-tab card. */
  .trips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }
  .trip {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-bottom: var(--space-md);
    border-bottom: 1px solid var(--rail-dim);
  }
  .trip:last-child {
    padding-bottom: 0;
    border-bottom: none;
  }
  .trip-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-md);
  }
  .trip-date {
    font-weight: var(--weight-label);
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .trip-km {
    font-size: var(--size-label);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .trip-route {
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .arrow {
    padding: 0 2px;
  }
  .trip-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-sm);
    font-size: var(--size-label);
  }
  .diary-tools {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--space-sm);
  }
  /* DD1 shelf — folder-card chrome, but a single full-width tap target with one job. */
  .dex-shelf {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    width: 100%;
    text-align: left;
    background: var(--white);
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-card);
    box-shadow: 0 2px 10px rgba(26, 26, 26, 0.05);
    padding: var(--space-lg);
    min-height: 44px;
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .dex-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    min-width: 0;
  }
  .dex-title {
    font-size: 15px;
    font-weight: var(--weight-display);
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
  }
  .dex-sub {
    font-size: var(--size-label);
    font-weight: var(--weight-label);
  }
  .dex-invite {
    font-size: var(--size-body);
  }
  .dex-meter {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }
  .dex-meter-num {
    display: flex;
    align-items: baseline;
    font-variant-numeric: tabular-nums;
  }
  /* DD2 idiom at shelf scale: the meter numerals are the anchor. */
  .dex-big {
    font-size: 26px;
    font-weight: var(--weight-display);
    color: var(--rail-lit);
    line-height: 1;
  }
  .dex-den {
    font-size: 14px;
  }
  .dex-meter-bar {
    flex: 1;
    min-width: 60px;
  }
  .dex-meter-label {
    font-size: var(--size-label);
    white-space: nowrap;
  }
  .dex-minis {
    display: flex;
    gap: var(--space-xs);
    align-items: center;
  }
  .dex-chevron {
    font-size: 22px;
    flex-shrink: 0;
  }
  /* DD5 inline expansion editor — opens under its trip row, list shifts smoothly. */
  .editor {
    margin-top: var(--space-sm);
    padding: var(--space-md);
    background: var(--rail-bg);
    border-radius: var(--radius-button);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    animation: editor-open 180ms ease-out;
  }
  @keyframes editor-open {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .editor {
      animation: none;
    }
  }
  .editor-label {
    font-size: var(--size-label);
  }
  .editor-input {
    width: 100%;
    min-height: 44px;
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-button);
    font-size: 16px; /* >=16px keeps iOS from zooming the focused field */
    background: var(--white);
    color: var(--ink);
  }
  .editor-preview {
    font-size: var(--size-label);
    margin: 0;
  }
  .editor-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }
  .editor-actions {
    display: flex;
    gap: var(--space-sm);
    justify-content: flex-end;
  }
  .ebtn {
    min-height: 44px;
    padding: 0 var(--space-lg);
    border-radius: var(--radius-button);
    border: 1px solid var(--rail-dim);
    background: var(--white);
    color: var(--ink);
    font-size: var(--size-label);
    font-weight: var(--weight-label);
  }
  .ebtn.primary {
    background: var(--rail-text);
    border-color: var(--rail-text);
    color: var(--white);
  }
  .ebtn:disabled {
    opacity: 0.5;
  }
</style>
