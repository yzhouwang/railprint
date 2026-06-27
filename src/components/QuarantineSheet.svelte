<script lang="ts">
  // Phase 4 — the quarantine review sheet. Orphaned rides (track abolished in a data refresh) are
  // GROUPED BY LINE — a refresh that drops 18 segments of one line is one group, not 18 rows. The
  // honest action for an abolished segment is "keep as a closed line": the ride stays as real
  // history and surfaces as a positive 廃線 km stat, never a coverage deduction. Bulk "すべて廃線
  // として残す" keeps a whole line in one tap. Reads only from IndexedDB-backed stores, so it works
  // offline. A modal dialog (focus-trapped surface), NOT a passive role="status" strip.
  import Button from './Button.svelte';
  import { orphanGroups, keepAsOrphan } from '../lib/store';

  interface Props {
    /** Close the sheet. */
    onclose: () => void;
  }
  let { onclose }: Props = $props();

  let busy = $state(false);

  async function keep(ids: string[]): Promise<void> {
    if (busy || ids.length === 0) return;
    busy = true;
    try {
      await keepAsOrphan(ids);
    } finally {
      busy = false;
    }
  }
</script>

<div
  class="backdrop"
  role="presentation"
  onclick={onclose}
  onkeydown={(e) => e.key === 'Escape' && onclose()}
></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="確認待ちの記録">
  <header class="head">
    <h2 class="htitle">確認待ちの記録</h2>
    <button class="close" type="button" aria-label="閉じる" onclick={onclose}>✕</button>
  </header>

  {#if $orphanGroups.length === 0}
    <div class="done">
      <p class="donemark" aria-hidden="true">✓</p>
      <p class="u-muted">すべて確認済みです。</p>
      <Button full onclick={onclose}>閉じる</Button>
    </div>
  {:else}
    <p class="reassure u-muted">
      路線の改定で、これらの記録の区間が変わった可能性があります。記録は安全です。廃線として残すと、統計に「廃線」km として記録されます。
    </p>
    <div class="groups">
      {#each $orphanGroups as g (g.lineId)}
        <section class="group">
          <div class="ghead">
            <span class="gname">{g.lineLabel}</span>
            <span class="gcount u-muted">{g.rides.length}区間</span>
          </div>
          <ul class="rides">
            {#each g.rides as r (r.id)}
              <li class="ride">
                <span class="rdate u-muted">{r.date ?? '日付なし'}</span>
                {#if r.km}<span class="rkm u-muted">{r.km.toLocaleString()} km</span>{/if}
                <button class="rkeep" type="button" disabled={busy} onclick={() => keep([r.id])}>
                  廃線として残す
                </button>
              </li>
            {/each}
          </ul>
          <Button full variant="secondary" disabled={busy} onclick={() => keep(g.rides.map((r) => r.id))}>
            すべて廃線として残す（{g.rides.length}）
          </Button>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(26, 26, 26, 0.32);
  }
  .sheet {
    position: fixed;
    z-index: 81;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    width: min(460px, 100%);
    max-height: 82vh;
    overflow-y: auto;
    background: var(--white);
    border-radius: var(--radius-card) var(--radius-card) 0 0;
    box-shadow: 0 -6px 30px rgba(26, 26, 26, 0.18);
    padding: var(--space-lg);
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }
  @media (min-width: 720px) {
    /* desktop: a centered panel rather than a bottom sheet */
    .sheet {
      bottom: auto;
      top: 50%;
      transform: translate(-50%, -50%);
      border-radius: var(--radius-card);
    }
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .htitle {
    margin: 0;
    font-size: 18px;
    font-weight: var(--weight-display);
  }
  .close {
    border: none;
    background: none;
    font-size: 18px;
    line-height: 1;
    padding: 6px;
    cursor: pointer;
    color: var(--rail-text);
  }
  .reassure {
    margin: 0;
    font-size: var(--size-label);
    line-height: 1.6;
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .ghead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .gname {
    font-weight: var(--weight-label);
  }
  .rides {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .ride {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: 8px 0;
    border-top: 1px solid var(--rail-dim);
  }
  .rdate {
    font-size: var(--size-label);
  }
  .rkm {
    font-size: var(--size-label);
  }
  .rkeep {
    margin-left: auto;
    min-height: 32px;
    padding: 0 var(--space-md);
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-button);
    background: var(--white);
    color: var(--rail-text);
    font-size: var(--size-label);
    cursor: pointer;
  }
  .rkeep:disabled {
    opacity: 0.5;
  }
  .done {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-md) 0;
    text-align: center;
  }
  .donemark {
    margin: 0;
    font-size: 32px;
    line-height: 1;
  }
</style>
