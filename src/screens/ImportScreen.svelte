<script lang="ts">
  // T4 importer + D2 review-and-resolve + T10 export — the v0 HERO.
  //
  // Flow: pick a CSV / paste text → parse (with the "取り込み中… 740/1,240" beat) →
  // either a PARSE ERROR row-report (nothing saved) OR the review-and-resolve list
  // ("X/Y mapped · Z need help") where unmatched/ambiguous rows get top suggestions to
  // confirm or skip → choose merge vs replace → commit. On success the toast fires and the
  // map floods green (the map listens to litSegmentIds, which the store recomputes).
  //
  // Also: the CSV export button + a gentle export-nag (tracked in db meta) + a one-time
  // storage.persist() request on first import (durability — the export is the backup).
  import { get } from 'svelte/store';
  import Button from '../components/Button.svelte';
  import FolderTabCard from '../components/FolderTabCard.svelte';
  import Pill from '../components/Pill.svelte';
  import Icon from '../components/Icon.svelte';
  import ProgressBar from '../components/ProgressBar.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import {
    events,
    geo,
    packages,
    headline,
    requestPersistence,
    removeEvents,
    seedCelebratedMilestones,
  } from '../lib/store';
  import { toast, goToTab } from '../lib/ui';
  import * as db from '../lib/db';
  import { parseImport, type ParseResult } from '../lib/import/parse';
  import { commitImport, type ImportMode } from '../lib/import/commit';
  import { exportEventsToCsv } from '../lib/export';
  import type { ImportResolution, ParsedRideRow } from '../contract/types';

  type Phase = 'idle' | 'parsing' | 'review' | 'error' | 'done';

  let phase = $state<Phase>('idle');
  let pasteText = $state('');
  let fileInput = $state<HTMLInputElement | null>(null);

  // Parse progress beat ("取り込み中… 740/1,240").
  let progressDone = $state(0);
  let progressTotal = $state(0);

  // Parse outcome.
  let parsed = $state<ParseResult | null>(null);
  let fatal = $state<string | null>(null);

  // Per-row review decisions: rawIndex → chosen suggestion segmentId ('' = undecided).
  let choice = $state<Record<number, string>>({});
  let skipped = $state<Record<number, boolean>>({});

  let mode = $state<ImportMode>('merge');
  let committing = $state(false);
  // Replace-mode is destructive (wipes the entire ridelog), so committing it routes through an
  // explicit confirm panel first. Merge commits straight through.
  let confirmingReplace = $state(false);
  // The confirm panel is a real alertdialog: on open we move focus INTO it (so keyboard + screen
  // reader land on the destructive gate, not still out in the page) and Escape cancels. A full Tab
  // focus-trap is deferred — same lightweight modal a11y the QuarantineSheet uses.
  let confirmEl: HTMLDivElement | undefined = $state();
  $effect(() => {
    if (confirmingReplace) confirmEl?.focus();
  });

  // Export is disabled (not just toast-on-tap) when there's nothing to write — so the user
  // doesn't tap to discover emptiness.
  const hasRides = $derived($events.length > 0);

  // Export-nag state.
  let nag = $state<string | null>(null);
  const NAG_KEY = 'lastExportAt';
  const PERSIST_KEY = 'persistRequested';

  $effect(() => {
    void refreshNag($events.length);
  });

  async function refreshNag(eventCount: number): Promise<void> {
    if (eventCount === 0) {
      nag = null;
      return;
    }
    const last = await db.getMeta<string>(NAG_KEY);
    if (!last) {
      nag = 'まだ一度も書き出していません。バックアップに CSV を保存しましょう。';
      return;
    }
    const days = (Date.now() - new Date(last).getTime()) / 86_400_000;
    nag =
      days >= 14
        ? `前回の書き出しから ${Math.floor(days)} 日。新しい記録を CSV に保存しておきましょう。`
        : null;
  }

  // ─────────────────────────── pick + parse ────────────────────────────────

  function pickFile(): void {
    fileInput?.click();
  }

  async function onFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    input.value = ''; // allow re-picking the same file
    void runParse(text);
  }

  function parsePasted(): void {
    if (!pasteText.trim()) {
      toast('CSV を貼り付けてください', 'info');
      return;
    }
    void runParse(pasteText);
  }

  async function runParse(text: string): Promise<void> {
    phase = 'parsing';
    parsed = null;
    fatal = null;
    choice = {};
    skipped = {};

    // The parse itself is synchronous + fast; the "740/1,240" beat is an honest, brief
    // count-up over the rows so a big import reads as deliberate work, not a frozen frame.
    const rowCount = Math.max(0, text.split(/\r\n|\r|\n/).filter((l) => l.trim()).length - 1);
    progressTotal = rowCount;
    progressDone = 0;

    const result = parseImport(text, get(packages), get(geo));

    await animateProgress(rowCount);

    if (result.fatal) {
      parsed = result;
      fatal = result.fatal;
      phase = 'error';
      return;
    }
    parsed = result;
    // Seed default choices: pre-select each review row's top suggestion (the user can
    // change or skip). Matched rows need no choice.
    const seedChoice: Record<number, string> = {};
    for (const r of result.resolved) {
      if (r.row.matchStatus !== 'matched' && r.row.suggestions?.length) {
        seedChoice[r.row.rawIndex] = r.row.suggestions[0].segmentId;
      }
    }
    choice = seedChoice;
    phase = 'review';
  }

  function animateProgress(total: number): Promise<void> {
    return new Promise((resolve) => {
      if (total <= 1 || typeof window === 'undefined') {
        progressDone = total;
        resolve();
        return;
      }
      const start = performance.now();
      const DURATION = Math.min(900, 200 + total * 4);
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / DURATION);
        progressDone = Math.round(t * total);
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          progressDone = total;
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  // ─────────────────────────── review helpers ──────────────────────────────

  const reviewRows = $derived(parsed?.report.needsReview ?? []);
  const matchedCount = $derived(parsed?.report.matched ?? 0);
  const total = $derived(parsed?.report.total ?? 0);

  // How many rows WILL commit: matched (auto) + reviewed rows with a chosen suggestion
  // that aren't skipped.
  const willCommit = $derived.by(() => {
    if (!parsed) return 0;
    let n = matchedCount;
    for (const r of reviewRows) {
      if (skipped[r.rawIndex]) continue;
      if (choice[r.rawIndex]) n++;
    }
    return n;
  });

  function chooseSuggestion(rawIndex: number, segmentId: string): void {
    choice = { ...choice, [rawIndex]: segmentId };
    skipped = { ...skipped, [rawIndex]: false };
  }

  function toggleSkip(rawIndex: number): void {
    const next = !skipped[rawIndex];
    skipped = { ...skipped, [rawIndex]: next };
  }

  function confidencePct(c: number): number {
    return Math.round(c * 100);
  }

  // ─────────────────────────── commit ──────────────────────────────────────

  function buildResolution(): ImportResolution {
    if (!parsed) throw new Error('no parse');
    const confirmed: { rawIndex: number; segmentId: string }[] = [];
    const skip: number[] = [];
    for (const r of reviewRows) {
      if (skipped[r.rawIndex]) {
        skip.push(r.rawIndex);
      } else if (choice[r.rawIndex]) {
        confirmed.push({ rawIndex: r.rawIndex, segmentId: choice[r.rawIndex] });
      } else {
        skip.push(r.rawIndex); // undecided review rows are treated as skipped (not committed)
      }
    }
    return { importBatchId: parsed.report.importBatchId, confirmed, skipped: skip };
  }

  // Commit trigger. Replace-mode is destructive (wipes the whole ridelog), so it routes through
  // an explicit confirm panel first; merge commits straight through.
  function requestCommit(): void {
    if (!parsed || committing) return;
    if (mode === 'replace') {
      confirmingReplace = true;
      return;
    }
    void commit();
  }

  function cancelReplace(): void {
    confirmingReplace = false;
  }

  function confirmReplace(): void {
    confirmingReplace = false;
    void commit();
  }

  async function commit(): Promise<void> {
    if (!parsed || committing) return;
    committing = true;
    try {
      const resolution = buildResolution();
      const committedMode = mode; // capture before reset() clears it
      const written = await commitImport(parsed.resolved, resolution, get(packages), mode);

      // Durability: first ever import asks the browser to make storage persistent.
      if (!(await db.getMeta<boolean>(PERSIST_KEY))) {
        await requestPersistence();
        await db.setMeta(PERSIST_KEY, true);
      }

      // v0.13 6A: an import/restore SEEDS the celebrated-milestone set silently — a backup
      // restore on a fresh device must never burst years-old achievement toasts. BEST-EFFORT
      // and isolated (ship review): the import above already committed durably, so a transient
      // IndexedDB failure in this cosmetic seed must never relabel a successful import as
      // failed, skip the persistence request, or eat the undo toast. Worst case on failure:
      // one stale celebration later — the accepted over/under-remember tradeoff.
      try {
        await seedCelebratedMilestones();
      } catch (err) {
        console.warn('[import] celebration seed failed (non-fatal)', err);
      }

      if (written.length === 0) {
        toast('取り込む区間がありませんでした', 'info');
      } else if (committedMode === 'replace') {
        // A replace already WIPED the prior log, so there's nothing to undo back to — offering
        // "元に戻す" would just delete the new rows and leave the user with an empty log, not a
        // restore. So a replace confirms (the destructive gate) but does not offer undo.
        toast(`${written.length.toLocaleString()}件で置き換えました`, 'success');
      } else {
        // The signature beat: the toast fires and the map floods green. Undo deletes EXACTLY the
        // rows this commit wrote (by id, not by the content-derived batch), so it can never remove
        // an older import that hashed to the same batch. A longer ttl gives time to react.
        const undoIds = written.map((e) => e.id);
        toast(
          `${written.length.toLocaleString()}件を取り込みました`,
          'success',
          6000,
          { label: '元に戻す', fn: () => void removeEvents(undoIds) },
        );
      }
      phase = 'done';
    } catch (err) {
      toast('取り込みに失敗しました。記録は変更されていません。', 'error');
      phase = 'review';
    } finally {
      committing = false;
    }
  }

  function reset(): void {
    phase = 'idle';
    parsed = null;
    fatal = null;
    pasteText = '';
    choice = {};
    skipped = {};
    confirmingReplace = false;
    // Back to the safe default: a destructive 'replace' choice must NOT persist into the next,
    // separate import (that was a sticky-mode footgun — the commit path caches `committedMode`).
    mode = 'merge';
  }

  function viewMap(): void {
    goToTab('map');
  }

  // ─────────────────────────── export ──────────────────────────────────────

  function doExport(): void {
    const evs = get(events);
    if (evs.length === 0) {
      toast('まだ書き出す記録がありません', 'info');
      return;
    }
    const csv = exportEventsToCsv(evs, get(packages));
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `railprint-${stamp}.csv`);
    void db.setMeta(NAG_KEY, new Date().toISOString());
    nag = null;
    toast('CSV を書き出しました', 'success');
  }

  function downloadCsv(csv: string, filename: string): void {
    if (typeof document === 'undefined') return;
    // BOM so Excel on Windows opens the JP text in UTF-8 (the incumbent audience).
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
</script>

<!-- Escape cancels the destructive replace-confirm dialog. Top-level (svelte:window must not nest
     inside a block); the handler is inert unless the dialog is open. -->
<svelte:window onkeydown={(e) => confirmingReplace && e.key === 'Escape' && cancelReplace()} />

<div class="import">
  <h1 class="title">取込</h1>

  {#if phase === 'idle'}
    {#if !$headline.hasRides}
      <!-- Cold start routes through the warm empty-state hero. -->
      <EmptyState />
    {/if}
    <p class="u-muted lead">
      乗りつぶしオンライン / RailLab の CSV を取り込んで、地図を一気に灯します。
    </p>

    <input
      bind:this={fileInput}
      type="file"
      accept=".csv,text/csv,text/plain"
      class="visually-hidden"
      onchange={onFile}
      aria-hidden="true"
      tabindex="-1"
    />
    <Button icon="import" full onclick={pickFile}>CSV を選択</Button>

    <details class="paste">
      <summary>または CSV を貼り付け</summary>
      <label class="visually-hidden" for="paste-area">CSV テキスト</label>
      <textarea
        id="paste-area"
        bind:value={pasteText}
        rows="5"
        placeholder="路線名,乗車駅,降車駅,乗車日&#10;山手線,東京,新宿,2025-04-01"
      ></textarea>
      <Button variant="secondary" full onclick={parsePasted}>貼り付けたCSVを取り込む</Button>
    </details>

    <hr class="rule" />

    <Button variant="secondary" icon="download" full disabled={!hasRides} onclick={doExport}>
      CSV を書き出す
    </Button>
    {#if nag}
      <p class="nag" role="status">
        <Icon name="info" size={16} />
        <span>{nag}</span>
      </p>
    {/if}
    {#if $headline.hasRides}
      <p class="u-muted small">
        現在 {Math.round($headline.riddenKm).toLocaleString()} km を記録済み。
      </p>
    {/if}
  {/if}

  {#if phase === 'parsing'}
    <FolderTabCard label="取込中">
      <div class="parsing">
        <p class="parsing-count u-display">
          {progressDone.toLocaleString()}<span class="slash">/</span>{progressTotal.toLocaleString()}
        </p>
        <p class="u-muted">取り込み中…</p>
        <ProgressBar
          value={progressTotal > 0 ? (progressDone / progressTotal) * 100 : 0}
          label="取り込み進捗"
        />
      </div>
    </FolderTabCard>
  {/if}

  {#if phase === 'error' && parsed}
    <FolderTabCard label="取り込めません">
      <div class="report">
        <p class="error-head">
          <Icon name="alert" size={18} />
          <span>{fatal}</span>
        </p>
        <p class="u-muted small">記録は何も保存されていません。</p>
        <ul class="hints u-muted small">
          <li>路線・駅（または区間）の列を含む CSV か確認してください。</li>
          <li>1 行目はヘッダー（列名）にしてください。</li>
        </ul>
        <Button variant="secondary" full onclick={reset}>やり直す</Button>
      </div>
    </FolderTabCard>
  {/if}

  {#if phase === 'review' && parsed}
    <FolderTabCard label="確認">
      <div class="summary">
        <p class="summary-line">
          <span class="big u-display">{matchedCount.toLocaleString()}</span>
          <span class="u-muted">/ {total.toLocaleString()} 件マッチ</span>
          {#if reviewRows.length > 0}
            <Pill>{reviewRows.length} 件は確認が必要</Pill>
          {/if}
        </p>
        {#if parsed.reimport}
          <p class="u-muted small">RailPrint の書き出しCSVを取り込みます。</p>
        {/if}
      </div>
    </FolderTabCard>

    {#if reviewRows.length > 0}
      <p class="review-help u-muted small">
        近い候補を選ぶか、スキップしてください。確定した行だけが取り込まれます。
      </p>
      <ul class="rows">
        {#each reviewRows as row (row.rawIndex)}
          {@render reviewItem(row)}
        {/each}
      </ul>
    {:else}
      <p class="all-clear u-muted small">
        <Icon name="check" size={16} />
        すべての行がマッチしました。
      </p>
    {/if}

    <FolderTabCard label="取り込み方法">
      <div class="mode">
        <div class="mode-opts" role="group" aria-label="取り込み方法">
          <button
            class="mode-opt"
            class:on={mode === 'merge'}
            aria-pressed={mode === 'merge'}
            onclick={() => (mode = 'merge')}
          >
            <span class="mode-name">追加（マージ）</span>
            <span class="mode-desc u-muted">今ある記録に足します。重複は自動でまとめます。</span>
          </button>
          <button
            class="mode-opt"
            class:on={mode === 'replace'}
            aria-pressed={mode === 'replace'}
            onclick={() => (mode = 'replace')}
          >
            <span class="mode-name">置き換え</span>
            <span class="mode-desc u-muted">今ある記録を、この取り込みで丸ごと置き換えます。</span>
          </button>
        </div>
      </div>
    </FolderTabCard>

    {#if confirmingReplace}
      <!-- Replace is irreversible: an explicit, clearly-marked destructive confirm gates it.
           Cancel is the default (primary-weight) action; Confirm is the destructive one.
           Focus moves into the panel on open (bind:this + $effect) and Escape cancels (via the
           top-level svelte:window guarded on confirmingReplace), so the alertdialog role is honest. -->
      <FolderTabCard label="置き換えの確認">
        <div
          class="confirm"
          bind:this={confirmEl}
          tabindex="-1"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-head"
        >
          <p id="confirm-head" class="confirm-head">
            <Icon name="alert" size={18} />
            <span>今ある記録をすべて削除します。</span>
          </p>
          <p class="u-muted small">
            置き換えると、これまでの {$events.length.toLocaleString()} 件の記録は
            <strong>すべて消えます</strong>。この操作は取り消せません。
          </p>
          <div class="confirm-actions">
            <Button variant="secondary" onclick={cancelReplace}>やめる</Button>
            <button type="button" class="danger-btn" onclick={confirmReplace}>
              <Icon name="alert" size={18} />
              <span>すべて削除して置き換える</span>
            </button>
          </div>
        </div>
      </FolderTabCard>
    {/if}

    <div class="commit-bar">
      <Button variant="secondary" onclick={reset}>やめる</Button>
      <Button icon="check" disabled={committing || willCommit === 0} onclick={requestCommit}>
        {#if committing}
          <span class="committing">
            <span class="spinner" aria-hidden="true"></span>
            取り込み中…
          </span>
        {:else}
          {willCommit.toLocaleString()}件を取り込む
        {/if}
      </Button>
    </div>
  {/if}

  {#if phase === 'done'}
    <FolderTabCard label="完了">
      <div class="done">
        <p class="done-head">
          <Icon name="check" size={20} />
          取り込みが完了しました。
        </p>
        <p class="u-muted">地図が緑に灯りました。</p>
        <div class="done-actions">
          <Button icon="map" full onclick={viewMap}>地図を見る</Button>
          <Button variant="secondary" icon="download" full onclick={doExport}>
            CSV を書き出す（バックアップ）
          </Button>
          <Button variant="secondary" full onclick={reset}>続けて取り込む</Button>
        </div>
      </div>
    </FolderTabCard>
  {/if}
</div>

{#snippet reviewItem(row: ParsedRideRow)}
  <li class="row-card" class:skipped={skipped[row.rawIndex]}>
    <div class="row-head">
      <span class="raw">{row.rawName}</span>
      {#if row.date}<span class="u-muted small">{row.date}</span>{/if}
    </div>
    {#if row.suggestions?.length}
      <ul class="sugg" role="group" aria-label={`${row.rawName} の候補`}>
        {#each row.suggestions as s (s.segmentId)}
          <li>
            <button
              class="sugg-opt"
              class:on={choice[row.rawIndex] === s.segmentId && !skipped[row.rawIndex]}
              aria-pressed={choice[row.rawIndex] === s.segmentId && !skipped[row.rawIndex]}
              onclick={() => chooseSuggestion(row.rawIndex, s.segmentId)}
            >
              <span class="sugg-label">{s.label}</span>
              <span class="conf u-emphasis">{confidencePct(s.confidence)}%</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="no-sugg u-muted small">候補が見つかりませんでした。</p>
    {/if}
    <button class="skip" class:on={skipped[row.rawIndex]} onclick={() => toggleSkip(row.rawIndex)}>
      {skipped[row.rawIndex] ? 'スキップ中（取り込まない）' : 'この行をスキップ'}
    </button>
  </li>
{/snippet}

<style>
  .import {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-lg);
    max-width: 480px;
    margin: 0 auto;
  }
  .title {
    margin: var(--space-sm) 0 0;
    font-size: 22px;
    font-weight: var(--weight-display);
  }
  .lead {
    margin: 0 0 var(--space-xs);
    font-size: var(--size-body);
    line-height: 1.6;
  }
  .small {
    font-size: var(--size-label);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* paste-CSV disclosure */
  .paste {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .paste > summary {
    cursor: pointer;
    color: var(--rail-text);
    font-size: var(--size-label);
    font-weight: var(--weight-label);
    min-height: 32px;
    display: flex;
    align-items: center;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-family);
    font-size: var(--size-body);
    padding: var(--space-sm);
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-button);
    resize: vertical;
  }
  textarea:focus-visible {
    outline: 2px solid var(--rail-text);
    outline-offset: 1px;
  }
  .rule {
    border: none;
    border-top: 1px solid var(--rail-dim);
    margin: var(--space-sm) 0;
    width: 100%;
  }
  .nag {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin: 0;
    color: var(--rail-text);
    font-size: var(--size-label);
    line-height: 1.5;
  }

  /* parsing beat */
  .parsing {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    align-items: center;
    text-align: center;
  }
  .parsing-count {
    font-size: var(--size-km);
    letter-spacing: 0.01em;
  }
  .parsing-count .slash {
    margin: 0 4px;
    color: var(--ink-muted);
  }

  /* parse-error report */
  .report {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .error-head {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin: 0;
    color: var(--ink);
    font-weight: var(--weight-label);
  }
  .hints {
    margin: 0;
    padding-left: 1.2em;
    line-height: 1.6;
  }

  /* review summary */
  .summary-line {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-sm);
    margin: 0;
  }
  .big {
    font-size: var(--size-km);
  }
  .review-help {
    margin: 0;
    line-height: 1.5;
  }
  .all-clear {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    margin: 0;
    color: var(--rail-text);
  }

  /* review rows */
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .row-card {
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-card);
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    background: var(--white);
  }
  .row-card.skipped {
    opacity: 0.55;
  }
  .row-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-sm);
  }
  .raw {
    font-weight: var(--weight-label);
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .sugg {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sugg-opt {
    width: 100%;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-button);
    background: var(--white);
    text-align: left;
    transition: border-color 0.12s ease, background 0.12s ease;
  }
  .sugg-opt.on {
    border-color: var(--rail-text);
    background: var(--rail-bg);
  }
  .sugg-opt:focus-visible {
    outline: 2px solid var(--rail-text);
    outline-offset: 1px;
  }
  .sugg-label {
    overflow-wrap: anywhere;
  }
  .conf {
    font-size: var(--size-label);
    white-space: nowrap;
  }
  .no-sugg {
    margin: 0;
  }
  .skip {
    align-self: flex-start;
    min-height: 32px;
    background: none;
    border: none;
    padding: 4px 0;
    color: var(--ink-muted);
    font-size: var(--size-label);
    font-weight: var(--weight-label);
    text-decoration: underline;
  }
  .skip.on {
    color: var(--rail-text);
  }
  .skip:focus-visible {
    outline: 2px solid var(--rail-text);
    outline-offset: 2px;
  }

  /* merge vs replace */
  .mode-opts {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .mode-opt {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    padding: var(--space-md);
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-button);
    background: var(--white);
    min-height: 44px;
  }
  .mode-opt.on {
    border-color: var(--rail-text);
    background: var(--rail-bg);
  }
  .mode-opt:focus-visible {
    outline: 2px solid var(--rail-text);
    outline-offset: 1px;
  }
  .mode-name {
    font-weight: var(--weight-label);
    color: var(--ink);
  }
  .mode-desc {
    font-size: var(--size-label);
    line-height: 1.4;
  }

  .commit-bar {
    display: flex;
    gap: var(--space-sm);
    justify-content: flex-end;
    position: sticky;
    bottom: var(--space-sm);
  }

  /* in-flight commit affordance — a small spinner so a big import doesn't read as frozen */
  .committing {
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
  }
  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 1.8s;
    }
  }

  /* replace-mode destructive confirm */
  .confirm {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .confirm-head {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin: 0;
    color: var(--ink);
    font-weight: var(--weight-label);
  }
  .confirm-actions {
    display: flex;
    gap: var(--space-sm);
    justify-content: flex-end;
    margin-top: var(--space-xs);
  }
  /* destructive action. The system is emerald-monochrome with NO danger hue (DESIGN.md), and
     toasts already mark "serious" with the ink surface + alert glyph, not a second color. The
     danger button follows that: an ink (not emerald) fill + the alert glyph so it reads clearly
     as "this deletes" and is distinct from the emerald primary, without forking the palette.
     Button.svelte only ships primary/secondary, so it's local but mirrors Button's metrics. */
  .danger-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    min-height: 44px;
    padding: 0 var(--space-lg);
    border-radius: var(--radius-button);
    font-size: var(--size-stat);
    font-weight: var(--weight-label);
    border: 2px solid var(--ink);
    background: var(--ink);
    color: var(--white);
    transition: transform 0.08s ease, opacity 0.15s ease;
  }
  .danger-btn:active {
    transform: scale(0.98);
  }
  .danger-btn:focus-visible {
    outline: 2px solid var(--rail-text);
    outline-offset: 2px;
  }

  /* done */
  .done {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .done-head {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin: 0;
    color: var(--rail-text);
    font-weight: var(--weight-label);
    font-size: var(--size-stat);
  }
  .done-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    margin-top: var(--space-sm);
  }
</style>
