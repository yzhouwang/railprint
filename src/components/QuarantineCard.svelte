<script lang="ts">
  // Phase 4 — the quiet entry point for the quarantine review. Lives in the 統計 screen BELOW the
  // coverage cards (NOT the .degraded top banner, which means the whole network failed). Orphans are
  // persistent and per-ride: rides whose track was abolished in a data refresh. Calm, never red —
  // these are not errors, they're history that needs a decision. Renders only when there are pending
  // orphans; the parent also guards.
  import FolderTabCard from './FolderTabCard.svelte';
  import Button from './Button.svelte';
  import { orphanCount } from '../lib/store';

  interface Props {
    /** Open the review sheet. */
    onopen: () => void;
  }
  let { onopen }: Props = $props();
</script>

{#if $orphanCount > 0}
  <FolderTabCard label="確認待ち">
    <div class="q">
      <p class="lede">
        <span class="num u-display">{$orphanCount}</span>
        <span class="copy u-muted">件の記録の区間が、路線の改定で見つかりません。記録は安全です。</span>
      </p>
      <Button full variant="secondary" onclick={onopen}>確認する</Button>
    </div>
  </FolderTabCard>
{/if}

<style>
  .q {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }
  .lede {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  .num {
    font-size: 26px;
    line-height: 1;
  }
  .copy {
    flex: 1;
    min-width: 12ch;
    line-height: 1.5;
  }
</style>
