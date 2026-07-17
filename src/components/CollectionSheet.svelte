<script lang="ts">
  // T5 — the 車両図鑑 collection sheet (plan D5/D6, design DD2/DD9/DD13/DD14/DD15).
  //
  // Composition (DD2, meter-as-anchor): sticky header (車両図鑑 · N車両 · ✕) → milestone
  // stamps row (DD7: typographic only, no emoji) → sections in summary order — 新幹線 with
  // the LARGE X/12 anchor numerals + bar + あとN形式, 中国高速鉄道 with the corridor meter
  // (京沪で会える車両), open counts (no denominator, D6 honesty) for 特急/通勤/気動車,
  // text-only dashed cards for その他 (verbatim spellings) — → ロースター基準 footer.
  //
  // Container (DD9): mobile = a true 100dvh full sheet with sticky header + momentum scroll;
  // ≥720px = a centered min(920px, 90vw) × 85vh panel with a 4-col grid. QuarantineSheet's
  // open/close/backdrop/Escape IDIOM, deliberately not its geometry. z-index 82/83 sits
  // above the tab bar and above QuarantineSheet's 80/81.
  //
  // Detail navigation (DD14): tapping a card swaps to an in-sheet detail view — the sticky
  // header becomes [← 戻る] + the model name; back/Escape returns to the grid and restores
  // focus + scroll to the tapped card (via its data-fold attribute). The detail trip list
  // follows D16 honesty: trips whose model-carrying events resolve in NO loaded package are
  // NOT hidden — they render with the DD15 fallback labels (廃線 for kept-quarantine rows,
  // データ未読込 otherwise), because a degraded boot or an abolished line must never make
  // ride history vanish.
  //
  // Membership/meters all derive from the pure lib (summarizeCollection reads RAW events —
  // D16); this component only lays the summary out. Accent hues appear ONLY inside the
  // silhouette fills (DD8) — chrome is emerald-system, with ONE user-blessed exception:
  // the amber 引退迫る caution tag (retirement urgency is roster data; approved board).
  import { tick } from 'svelte';
  import FolderTabCard from './FolderTabCard.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import TrainSilhouette from './TrainSilhouette.svelte';
  import { silhouetteSpec } from '../lib/silhouette-specs';
  import { events, packages, geo, collection } from '../lib/store';
  import { deriveMilestones, type ModelStanding, type SectionMeter } from '../lib/collection';
  import { summarizeTrips } from '../lib/trips';
  import { collectionFold, modelByFold, topSpeedKmh } from '../lib/train-models';
  import { ROSTER_BASIS_YEAR, type TrainModelInfo } from '../lib/model-registry';

  interface Props {
    /** Close the sheet. */
    onclose: () => void;
    /** Open directly on a model's detail view (DD4 toast tap-through / deep link). */
    initialFold?: string;
  }
  let { onclose, initialFold }: Props = $props();

  type View = { kind: 'grid' } | { kind: 'detail'; fold: string };
  // initialFold is DELIBERATELY read once: it seeds where the sheet opens (DD4 tap-through);
  // navigation afterwards is owned by this component, never re-driven by the prop.
  // svelte-ignore state_referenced_locally
  let view = $state<View>(
    initialFold !== undefined ? { kind: 'detail', fold: initialFold } : { kind: 'grid' },
  );
  let sheetEl: HTMLDivElement | undefined = $state();

  // The SHARED memoized summary (perf review): StatsScreen already subscribes to this
  // derived, so re-deriving locally would run summarizeCollection twice per events tick.
  const summary = $derived($collection);
  const milestones = $derived(deriveMilestones(summary));

  // The model behind the detail view. A ghost (uncollected) card is tappable too: it has no
  // ModelStanding, so we fall back to the registry entry for the want-list facts (未乗車).
  const detail = $derived.by(() => {
    if (view.kind !== 'detail') return undefined;
    // Deep-links may carry a RAW-string fold (e.g. the alias 'レールスター') while standings
    // key on the REGISTRY fold ('700') — canonicalize through the alias index first, or a
    // just-collected model would render as 未乗車 (review finding, alias class).
    const fold = modelByFold(view.fold)?.fold ?? view.fold;
    let standing: ModelStanding | undefined;
    for (const sec of summary.sections) {
      const hit = sec.collected.find((s) => s.fold === fold);
      if (hit) {
        standing = hit;
        break;
      }
    }
    const info: TrainModelInfo | undefined = standing?.info ?? modelByFold(fold);
    return {
      fold,
      standing,
      info,
      name: standing?.displayName ?? info?.name ?? fold,
      speed: info?.topSpeedKmh ?? topSpeedKmh(fold),
    };
  });

  interface DetailTripRow {
    key: string;
    date?: string;
    /** endpoint label, or the DD15 fallback (廃線 / データ未読込) when nothing resolves. */
    title: string;
    sub?: string;
    km?: number;
    createdAt: string;
    fallback: boolean;
  }

  // This model's trips — the StatsScreen diaryRows recipe (summarizeTrips per package,
  // endpoints/line names resolved against the geo index), filtered to trips whose events
  // carry this fold, PLUS the D16 raw-grouped remainder for unresolvable trips.
  const detailTrips = $derived.by((): DetailTripRow[] => {
    if (view.kind !== 'detail') return [];
    // Canonical CARD fold (ship review, alias class): rides stored as 'N700系7000番台' or
    // 'レールスター' must appear on their card's journey list — collectionFold is the ONE
    // identity every comparison below uses.
    const fold = modelByFold(view.fold)?.fold ?? view.fold;
    const idx = $geo;
    const rows: DetailTripRow[] = [];
    // Country-prefixed like diaryRows (ship review): a JP and CN trip sharing an imported
    // tripId must not shadow each other out of the fallback pass.
    const resolved = new Set<string>();
    for (const pkg of $packages) {
      for (const t of summarizeTrips($events, pkg)) {
        if (!t.trainModels.some((m) => collectionFold(m) === fold)) continue;
        resolved.add(`${pkg.country}:${t.tripId}`);
        const name = (id: string | undefined): string =>
          (id && idx.stationById.get(id)?.name) || '?';
        const lineNames: string[] = [];
        for (const id of t.lineIds) {
          const n = idx.lineById.get(id)?.name;
          if (n) lineNames.push(n);
        }
        rows.push({
          key: `${pkg.country}:${t.tripId}`,
          date: t.date,
          title: `${name(t.fromStationId)} → ${name(t.toStationId)}`,
          sub: lineNames.length === 1 ? lineNames[0] : `${t.lineIds.length}路線`,
          km: t.km,
          createdAt: t.createdAt,
          fallback: false,
        });
      }
    }
    // D16 honesty: model-carrying trips that resolved NOWHERE still render — with a fallback
    // label, never hidden. Same trip bucketing as trips.ts (tripId ?? solo:<eventId>). km sums
    // the record-time snapshots (ev.km) when present; 0 hides the cell rather than faking it.
    interface RawBucket {
      dates: string[];
      createdAts: string[];
      km: number;
      count: number;
      kept: boolean;
    }
    const raw = new Map<string, RawBucket>();
    const segCountry = new Map<string, string>();
    for (const p of $packages) for (const seg of p.segments) segCountry.set(seg.segmentId, p.country);
    for (const ev of $events) {
      if (collectionFold(ev.trainModel) !== fold) continue;
      const key = ev.tripId ?? `solo:${ev.id}`;
      // shown already iff the OWNING package's summary rendered this trip (unresolved rows
      // have no owner and always reach the fallback pass — D16).
      const owner = segCountry.get(ev.segmentId);
      if (owner !== undefined && resolved.has(`${owner}:${key}`)) continue;
      let b = raw.get(key);
      if (!b) {
        b = { dates: [], createdAts: [], km: 0, count: 0, kept: false };
        raw.set(key, b);
      }
      if (ev.date) b.dates.push(ev.date);
      b.createdAts.push(ev.createdAt);
      b.km += ev.km ?? 0;
      b.count++;
      if (ev.quarantine === 'kept') b.kept = true;
    }
    for (const [key, b] of raw) {
      rows.push({
        key: `raw:${key}`,
        date: b.dates.length ? [...b.dates].sort()[0] : undefined,
        title: b.kept ? '廃線' : 'データ未読込',
        sub: `${b.count}区間`,
        km: b.km > 0 ? Math.round(b.km * 100) / 100 : undefined,
        createdAt: [...b.createdAts].sort()[0],
        fallback: true,
      });
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows;
  });

  // "2025-11-03" → "2025.11.03" (diary convention); undated imports read 日付なし.
  const dateLabel = (d: string | undefined): string => (d ? d.replaceAll('-', '.') : '日付なし');
  // Card sub uses the short year.month form from the approved board ("3回 · 2024.5").
  const ym = (d: string): string => {
    const [y, m] = d.split('-');
    return m ? `${y}.${Number(m)}` : y;
  };
  const cardSub = (s: ModelStanding): string =>
    s.firstRidden ? `${s.rideCount}回 · ${ym(s.firstRidden)}` : `${s.rideCount}回`;
  const meterPct = (m: SectionMeter): number => (m.total > 0 ? (m.collected / m.total) * 100 : 0);

  function openDetail(fold: string): void {
    view = { kind: 'detail', fold };
    if (sheetEl) sheetEl.scrollTop = 0; // detail replaces the grid inside the same container
  }

  // DD14: back restores focus + scroll to the card that opened the detail (by data-fold).
  async function back(): Promise<void> {
    if (view.kind !== 'detail') return;
    const fold = view.fold;
    view = { kind: 'grid' };
    await tick();
    const el = sheetEl?.querySelector<HTMLButtonElement>(
      `button[data-fold="${CSS.escape(fold)}"]`,
    );
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'nearest' });
    } else {
      sheetEl?.focus();
    }
  }

  // DD13 roving arrow-key nav: attached to each card button; moves focus across the cells of
  // the button's own section grid. Column count mirrors the CSS breakpoint (3 → 4 at 720px).
  function gridNav(e: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const btn = e.currentTarget as HTMLElement;
    const grid = btn.closest('.grid');
    if (!grid) return;
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('button.card'));
    const i = cells.indexOf(btn);
    if (i < 0) return;
    const cols = window.matchMedia('(min-width: 720px)').matches ? 4 : 3;
    const j =
      e.key === 'ArrowLeft' ? i - 1
      : e.key === 'ArrowRight' ? i + 1
      : e.key === 'ArrowUp' ? i - cols
      : i + cols;
    if (j < 0 || j >= cells.length) return;
    e.preventDefault();
    cells[j].focus();
  }

  // Initial focus lands on the sheet itself (tabindex -1) — QuarantineSheet idiom.
  $effect(() => {
    sheetEl?.focus();
  });

  // DD13 Tab focus trap (ship review): aria-modal promises keyboard isolation — Tab and
  // Shift+Tab cycle within the sheet's focusables instead of escaping to the UI behind
  // the backdrop. Recomputed per keypress (the focusable set changes with the view swap).
  function trapTab(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !sheetEl) return;
    const focusables = [...sheetEl.querySelectorAll<HTMLElement>(
      'button, input, [tabindex]:not([tabindex="-1"])',
    )].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || active === sheetEl)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (active && !sheetEl.contains(active)) {
      // focus escaped (e.g. via pointer) — pull the cycle back inside
      e.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window
  onkeydown={(e) => {
    trapTab(e);
    if (e.key !== 'Escape') return;
    if (view.kind === 'detail') void back(); // DD14: Escape backs out of detail first
    else onclose();
  }}
/>
<div class="backdrop" role="presentation" onclick={onclose}></div>
<div
  class="sheet"
  bind:this={sheetEl}
  tabindex="-1"
  role="dialog"
  aria-modal="true"
  aria-labelledby="dex-title"
>
  <header class="head">
    {#if view.kind === 'detail'}
      <button class="backbtn" type="button" onclick={() => void back()}>← 戻る</button>
      <h2 class="htitle grow" id="dex-title">{detail?.name}</h2>
    {:else}
      <h2 class="htitle" id="dex-title">車両図鑑</h2>
      <span class="total u-muted">{summary.totalModels}車両</span>
    {/if}
    <button class="close" type="button" aria-label="車両図鑑を閉じる" onclick={onclose}>✕</button>
  </header>

  <div class="body">
    {#if view.kind === 'grid'}
      <!-- DD7 stamps: typographic only — dashed emerald + mint when earned, dim dashed when not -->
      <div class="stamps" role="list" aria-label="マイルストーン">
        {#each milestones as m (m.id)}
          <span class="stamp" class:earned={m.earned} role="listitem">{m.label}</span>
        {/each}
      </div>

      {#if summary.totalModels === 0}
        <!-- DD15 zero state: invite copy; the ghost roster below stays visible as the want-list -->
        <p class="invite">車両を記録すると図鑑が育ちます</p>
      {/if}

      <div class="sections">
        {#each summary.sections as sec (sec.category)}
          <FolderTabCard label={sec.label}>
            {#if sec.category === 'shinkansen' && sec.meter}
              <!-- DD2 meter-as-anchor: LARGE collected numeral, muted /total, bar, あとN形式 -->
              <div class="anchor">
                <span class="anum">{sec.meter.collected}</span><span class="adenom"
                  >/{sec.meter.total}</span
                >
                <div class="abar">
                  <ProgressBar value={meterPct(sec.meter)} label={sec.meter.label} />
                </div>
                {#if sec.meter.total - sec.meter.collected > 0}
                  <span class="aleft">あと{sec.meter.total - sec.meter.collected}形式</span>
                {/if}
              </div>
            {:else if sec.meter}
              <!-- cn-hsr corridor meter (D6: earnable roster only — 京沪で会える車両) -->
              <div class="meter">
                <b class="mnum">{sec.meter.collected}/{sec.meter.total}</b>
                <div class="mbar">
                  <ProgressBar value={meterPct(sec.meter)} label={sec.meter.label} />
                </div>
                <span class="mlabel u-muted">{sec.meter.label}</span>
              </div>
            {:else if sec.category !== 'other'}
              <!-- D6 honesty: open categories carry a count, NEVER a denominator -->
              <p class="opencount u-muted">{sec.collected.length}車両を記録</p>
            {/if}

            {#if sec.category === 'other'}
              <!-- その他: first-class cards, text-only + dashed, verbatim first-seen spelling.
                   Render capped (ship review): a hostile/huge import with thousands of DISTINCT
                   free-text models must not freeze the sheet — the summary stays complete
                   (counts/milestones honest), only the card list truncates, and says so. -->
              <div class="txlist">
                {#each sec.collected.slice(0, 60) as s (s.fold)}
                  <button
                    class="txcard"
                    type="button"
                    data-fold={s.fold}
                    onclick={() => openDetail(s.fold)}
                  >
                    <span class="txname">{s.displayName}</span>
                    <span class="txcount">{s.rideCount}回</span>
                  </button>
                {/each}
                {#if sec.collected.length > 60}
                  <p class="txmore u-muted">ほか {sec.collected.length - 60} 件（最近の乗車順）</p>
                {/if}
              </div>
            {:else}
              <div class="grid">
                {#each sec.collected as s (s.fold)}
                  <button
                    class="card"
                    type="button"
                    data-fold={s.fold}
                    onclick={() => openDetail(s.fold)}
                    onkeydown={gridNav}
                  >
                    {#if s.info?.retiresNote}<span class="tag">引退迫る</span>{/if}
                    <TrainSilhouette
                      variant={s.info?.silhouette ?? 'commuter'}
                      fill={s.info?.accentColor ?? 'var(--rail-lit)'}
                      spec={silhouetteSpec(s.fold)}
                    />
                    <span class="nm">{s.displayName}</span>
                    <span class="st">{cardSub(s)}</span>
                  </button>
                {/each}
                {#each sec.uncollected as g (g.fold)}
                  <!-- ghost want-list card: NO fill prop → DD10 ghost token; 未乗車 label so the
                       state never reads by hue alone -->
                  <button
                    class="card ghost"
                    type="button"
                    data-fold={g.fold}
                    onclick={() => openDetail(g.fold)}
                    onkeydown={gridNav}
                  >
                    {#if g.retiresNote}<span class="tag">引退迫る</span>{/if}
                    <TrainSilhouette variant={g.silhouette} spec={silhouetteSpec(g.fold)} />
                    <span class="nm">{g.name}</span>
                    <span class="st">未乗車</span>
                  </button>
                {/each}
              </div>
            {/if}
          </FolderTabCard>
        {/each}
      </div>

      <p class="foot u-muted">ロースター基準: {ROSTER_BASIS_YEAR}年</p>
    {:else if detail}
      <div class="detail">
        {#if detail.info}
          <div class="dsil">
            <TrainSilhouette
              variant={detail.info.silhouette}
              fill={detail.standing ? (detail.info.accentColor ?? 'var(--rail-lit)') : undefined}
              width={220}
              label={detail.name}
              spec={silhouetteSpec(detail.info.fold)}
            />
          </div>
        {/if}

        <div class="dmeta u-muted">
          {#if detail.info?.nameRomaji}<span>{detail.info.nameRomaji}</span>{/if}
          {#if detail.info?.operator}<span>{detail.info.operator}</span>{/if}
          {#if detail.speed}<span>{detail.speed} km/h</span>{/if}
        </div>

        {#if detail.info?.nicknames?.length}
          <div class="nicks" aria-label="愛称">
            {#each detail.info.nicknames as n (n)}
              <span class="nick">{n}</span>
            {/each}
          </div>
        {/if}

        {#if detail.info?.retiresNote}
          <p class="retire"><span class="tag tag-inline">引退迫る</span>{detail.info.retiresNote}</p>
        {/if}

        {#if detail.standing}
          <!-- DD15 stat labels, verbatim: 乗車回数 / 距離 / 初乗車日 -->
          <dl class="stats">
            <div>
              <dt>乗車回数</dt>
              <dd>{detail.standing.rideCount}回</dd>
            </div>
            <div>
              <dt>距離</dt>
              <dd>{detail.standing.km.toLocaleString('ja-JP')} km</dd>
            </div>
            <div>
              <dt>初乗車日</dt>
              <dd>{detail.standing.firstRidden ? dateLabel(detail.standing.firstRidden) : '—'}</dd>
            </div>
          </dl>

          {#if detail.standing.spellings.length > 1}
            <!-- read-time fold honesty: every raw spelling that merged into this card -->
            <p class="spellnote u-muted">
              {detail.standing.spellings.map((sp) => `「${sp}」`).join('')}として記録
            </p>
          {/if}

          <h3 class="dtripsh">この車両の旅</h3>
          {#if detailTrips.length === 0}
            <p class="u-muted">記録がありません</p>
          {:else}
            <ul class="dtrips">
              {#each detailTrips as r (r.key)}
                <li class="drow">
                  <span class="ddate u-muted">{dateLabel(r.date)}</span>
                  <span class="dtitle" class:fallback={r.fallback}>{r.title}</span>
                  {#if r.sub}<span class="dsub u-muted">{r.sub}</span>{/if}
                  {#if r.km}<span class="dkm u-muted">{r.km.toLocaleString('ja-JP')} km</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
          <p class="ghostnote u-muted">未乗車</p>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 82;
    background: rgba(26, 26, 26, 0.32);
  }
  /* DD9: mobile = true 100dvh sheet; desktop ≥720px = centered wide panel. DD11 semantic
     tokens live on the sheet root so the silhouettes + tags inherit them. */
  .sheet {
    position: fixed;
    inset: 0;
    z-index: 83;
    height: 100dvh;
    background: var(--white);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    display: flex;
    flex-direction: column;
    --dex-ghost-fill: #dce5df;
    --dex-collected-fill: var(--rail-lit);
    --dex-retiring-tag: #b8860b;
    --dex-retiring-bg: #fff4d6;
  }
  @media (min-width: 720px) {
    .sheet {
      inset: auto;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(920px, 90vw);
      height: auto;
      max-height: 85vh;
      border-radius: var(--radius-card);
      box-shadow: 0 6px 30px rgba(26, 26, 26, 0.18);
    }
  }
  .head {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    background: var(--white);
    padding: var(--space-md) var(--space-lg);
    border-bottom: 1px solid var(--rail-dim);
  }
  .htitle {
    margin: 0;
    font-size: 20px;
    font-weight: var(--weight-display);
  }
  .htitle.grow {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .total {
    font-size: var(--size-body);
  }
  .close {
    margin-left: auto;
    border: none;
    background: none;
    font-size: 18px;
    line-height: 1;
    min-width: 44px;
    min-height: 44px;
    margin-top: -8px;
    margin-bottom: -8px;
    cursor: pointer;
    color: var(--rail-text);
  }
  .backbtn {
    border: none;
    background: none;
    min-height: 44px;
    padding: 0 var(--space-sm) 0 0;
    font: inherit;
    font-weight: var(--weight-label);
    color: var(--rail-text);
    cursor: pointer;
    white-space: nowrap;
  }
  .body {
    padding: 0 var(--space-lg) var(--space-lg);
  }

  /* ── stamps (DD7) ── */
  .stamps {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-sm);
    margin: var(--space-md) 0 var(--space-xs);
  }
  .stamp {
    font-size: 12px;
    font-weight: 600;
    padding: 7px 12px;
    border-radius: var(--radius-pill);
    border: 1.5px dashed var(--rail-dim);
    color: var(--ink-muted);
    background: none;
    white-space: nowrap;
  }
  .stamp.earned {
    border-color: var(--rail-lit);
    background: var(--rail-bg);
    color: var(--rail-text);
  }

  .invite {
    margin: var(--space-sm) 0 0;
    font-size: var(--size-body);
    color: var(--ink-muted);
  }

  .sections {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  /* ── meters ── */
  .anchor {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin-bottom: var(--space-md);
  }
  .anum {
    font-size: 30px;
    font-weight: var(--weight-display);
    line-height: 1;
    color: var(--rail-lit); /* display numerals ≥24px may use emerald-600 (tokens.ts) */
  }
  .adenom {
    font-size: 16px;
    font-weight: var(--weight-display);
    color: var(--ink-muted);
  }
  .abar {
    flex: 1;
  }
  .aleft {
    font-size: var(--size-label);
    color: var(--ink-muted);
    white-space: nowrap;
  }
  .meter {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin-bottom: var(--space-md);
  }
  .mnum {
    font-size: 13px;
    font-weight: var(--weight-display);
    color: var(--rail-text);
  }
  .mbar {
    flex: 1;
  }
  .mlabel {
    font-size: var(--size-label);
    white-space: nowrap;
  }
  .opencount {
    margin: 0 0 var(--space-md);
    font-size: var(--size-body);
  }

  /* ── card grid (DD13: 3-col mobile / 4-col ≥720px, gap 10px, semantic buttons) ── */
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  @media (min-width: 720px) {
    .grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }
  .card {
    /* 166-entry roster renders ~150 ghost cards eagerly on open — content-visibility keeps
       offscreen cards unpainted so first paint stays flat as the roster grows (perf review). */
    content-visibility: auto;
    contain-intrinsic-size: auto 132px;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    background: var(--white);
    border: 1px solid var(--rail-dim);
    border-radius: 12px;
    padding: var(--space-sm) var(--space-sm) 10px;
    text-align: center;
    cursor: pointer;
    font: inherit;
    color: var(--ink);
    min-height: 44px;
    transition: border-color 0.15s ease;
  }
  .card:hover {
    border-color: var(--rail-lit);
  }
  .nm {
    /* DD11 type contract: model names 14px / 700 — never smaller */
    font-size: 14px;
    font-weight: 700;
    margin-top: 4px;
    overflow-wrap: anywhere;
  }
  .card.ghost .nm {
    color: var(--ink-muted);
  }
  .st {
    /* DD11: card meta 11px / 500 */
    font-size: 11px;
    font-weight: 500;
    color: var(--ink-muted);
  }
  .tag {
    position: absolute;
    top: 6px;
    right: 6px;
    /* 引退迫る amber is the USER-BLESSED caution exception to the emerald-monochrome chrome
       rule (ship design review): retirement urgency is roster DATA, matching the approved
       board. Do not cite this as precedent for new chrome hues. */
    font-size: var(--size-label, 11px);
    font-weight: 700;
    padding: 2px 5px;
    border-radius: 6px;
    background: var(--dex-retiring-bg);
    color: var(--dex-retiring-tag);
  }

  /* ── その他 text cards ── */
  .txlist {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .txmore {
    font-size: var(--size-label);
    margin: var(--space-xs) 0 0;
  }
  .txcard {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    border: 1px dashed var(--rail-dim);
    border-radius: 12px;
    background: var(--white);
    padding: 10px var(--space-md);
    min-height: 44px;
    font: inherit;
    color: var(--ink);
    cursor: pointer;
    text-align: left;
  }
  .txname {
    font-size: 14px;
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .txcount {
    font-size: 11px;
    font-weight: 500;
    color: var(--ink-muted);
    white-space: nowrap;
  }

  .foot {
    text-align: center;
    font-size: var(--size-label);
    padding: var(--space-lg) 0 var(--space-sm);
    margin: 0;
  }

  /* ── detail view (DD14/DD15) ── */
  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding-top: var(--space-md);
  }
  .dsil {
    display: flex;
    justify-content: center;
    padding: var(--space-md) 0;
    background: var(--rail-bg);
    border-radius: var(--radius-card);
  }
  .dmeta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs) var(--space-md);
    font-size: var(--size-body);
  }
  .nicks {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }
  .nick {
    font-size: var(--size-label);
    font-weight: var(--weight-label);
    padding: 4px 10px;
    border-radius: var(--radius-pill);
    background: var(--rail-bg);
    color: var(--rail-text);
  }
  .retire {
    margin: 0;
    font-size: var(--size-label);
    color: var(--ink-muted);
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }
  .tag-inline {
    position: static;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-sm);
    margin: 0;
  }
  .stats div {
    background: var(--rail-bg);
    border-radius: var(--radius-button);
    padding: var(--space-sm) var(--space-md);
  }
  .stats dt {
    font-size: var(--size-label);
    color: var(--ink-muted);
  }
  .stats dd {
    margin: 2px 0 0;
    font-size: 16px;
    font-weight: var(--weight-display);
    color: var(--rail-text);
  }
  .spellnote {
    margin: 0;
    font-size: var(--size-label);
  }
  .dtripsh {
    margin: var(--space-sm) 0 0;
    font-size: var(--size-body);
    font-weight: var(--weight-display);
  }
  .dtrips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .drow {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-sm);
    padding: 8px 0;
    border-top: 1px solid var(--rail-dim);
    font-size: var(--size-body);
  }
  .ddate {
    font-size: var(--size-label);
    white-space: nowrap;
  }
  .dtitle.fallback {
    color: var(--ink-muted);
  }
  .dsub {
    font-size: var(--size-label);
  }
  .dkm {
    margin-left: auto;
    font-size: var(--size-label);
    white-space: nowrap;
  }
  .ghostnote {
    margin: 0;
  }

  /* DD6/DD15: never animate for reduced-motion users */
  @media (prefers-reduced-motion: reduce) {
    .card {
      transition: none;
    }
  }
</style>
