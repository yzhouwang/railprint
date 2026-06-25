<script lang="ts">
  // T8 — the full stats view + the Wrapped <canvas> share card entry point.
  //
  // Reads coverage from the store (headline + per-package coverages + the geo index) and
  // renders: the completion StatCards (全国 + 新幹線), the superlatives ("your year in
  // rail"), the prefecture count, and the "Wrapped を作成" button that eagerly renders a
  // share image then hands it to share.ts. Works in both the 380px desktop side panel and
  // full-screen mobile. Empty/zero state degrades gracefully (no NaN).
  import { get } from 'svelte/store';
  import StatCard from '../components/StatCard.svelte';
  import FolderTabCard from '../components/FolderTabCard.svelte';
  import Button from '../components/Button.svelte';
  import Pill from '../components/Pill.svelte';
  import Diorama from '../components/Diorama.svelte';
  import { headline, coverages, geo, events } from '../lib/store';
  import { summarizeDiary, tripEndpoints } from '../lib/trips';
  import { toast } from '../lib/ui';
  import { buildWrappedData, renderWrappedBlobSync } from '../lib/wrapped/card';
  import { ensureWrappedFonts } from '../lib/wrapped/font';
  import { shareCard } from '../lib/wrapped/share';

  // Derive the resolved superlatives from the SAME pure shaper the canvas uses, so the
  // on-screen list and the exported card never drift.
  const wrapped = $derived(
    buildWrappedData({ headline: $headline, coverages: $coverages, geo: $geo }),
  );

  // 旅の記録 — the journey diary (D2: date-led rows; a repeat ride is just another dated row,
  // never collapsed). Built from summarizeDiary over each loaded package's events, then sorted
  // newest-first. Endpoints + line/model names are resolved against the geo index here so the
  // pure trips lib stays geometry-faithful and name-free.
  interface DiaryRow {
    tripId: string;
    date?: string;
    from: string;
    to: string;
    km: number;
    segCount: number;
    lineLabel: string;
    trainModels: string[];
    createdAt: string;
  }
  const diaryRows = $derived.by(() => {
    const idx = $geo;
    const stationName = (id: string) => idx.stationById.get(id)?.name ?? '?';
    const rows: DiaryRow[] = [];
    for (const { pkg } of $coverages) {
      for (const t of summarizeDiary($events, pkg).trips) {
        const ep = tripEndpoints(t, pkg);
        const lineNames: string[] = [];
        for (const id of t.lineIds) {
          const n = idx.lineById.get(id)?.name;
          if (n) lineNames.push(n);
        }
        rows.push({
          tripId: t.tripId,
          date: t.date,
          from: ep ? stationName(ep.fromStationId) : '?',
          to: ep ? stationName(ep.toStationId) : '?',
          km: t.km,
          segCount: t.segmentIds.length,
          lineLabel: lineNames.length === 1 ? lineNames[0] : `${t.lineIds.length}路線`,
          trainModels: t.trainModels,
          createdAt: t.createdAt,
        });
      }
    }
    // Newest journeys first (createdAt is the stable key; date may be absent on imports).
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows;
  });

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

  {#if $headline.hasRides}
    <StatCard pct={$headline.pctNational} riddenKm={$headline.riddenKm} caption="全国" />
    {#if $headline.hsrTotalKm > 0}
      <StatCard
        label="新幹線"
        pct={$headline.pctHSR}
        riddenKm={$headline.hsrRiddenKm}
        caption="高速鉄道"
      />
    {/if}

    <FolderTabCard label="記録">
      <div class="rows">
        <div class="row">
          <span class="u-label">都道府県・地域</span>
          <span class="rowval"><span class="num u-display">{$headline.prefectures}</span></span>
        </div>
        {#each wrapped.superlatives as s (s.label)}
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

    <FolderTabCard label="旅の記録">
      {#if diaryRows.length > 0}
        <ul class="trips">
          {#each diaryRows as t (t.tripId)}
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
                {#each t.trainModels as m (m)}<Pill>{m}</Pill>{/each}
              </div>
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
</style>
