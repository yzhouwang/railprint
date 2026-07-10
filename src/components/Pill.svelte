<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    active?: boolean;
    /**
     * DD12 variants:
     *  - 'default'  — the original pill (interactive form meets 44px min-height).
     *  - 'compact'  — dense-row tappable pill: visual height stays small so diary rows keep
     *    their rhythm; the 44px touch target is provided by an ::after overlay, not the box.
     *    Resting look (outline + chevron-less) stays distinct from `.active` (dark fill),
     *    so "tappable" never reads as "selected".
     *  - 'ghost-add' — the ＋車両 affordance: dashed outline, muted, invitation-not-data.
     */
    variant?: 'default' | 'compact' | 'ghost-add';
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  }
  let { active = false, variant = 'default', onclick, children }: Props = $props();
</script>

{#if onclick}
  <button
    class="pill"
    class:active
    class:compact={variant === 'compact'}
    class:ghost={variant === 'ghost-add'}
    {onclick}
    aria-pressed={variant === 'ghost-add' ? undefined : active}
  >
    {@render children()}
  </button>
{:else}
  <span class="pill" class:active class:ghost={variant === 'ghost-add'}>{@render children()}</span>
{/if}

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding: 6px var(--space-md);
    border-radius: var(--radius-pill);
    font-size: var(--size-label);
    font-weight: var(--weight-label);
    background: var(--rail-bg);
    color: var(--rail-text);
    border: 1px solid transparent;
    white-space: nowrap;
  }
  button.pill {
    /* interactive chips meet the 44px touch-target minimum (DESIGN.md) */
    min-height: 44px;
  }
  /* DD12 compact: dense rows keep their height; the hit area, not the box, is 44px. */
  button.pill.compact {
    min-height: 0;
    position: relative;
    border-color: var(--rail-dim);
    background: var(--white);
  }
  button.pill.compact::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 44px;
    transform: translateY(-50%);
  }
  .pill.ghost {
    background: none;
    border: 1px dashed var(--rail-dim);
    color: var(--ink-muted, var(--rail-text));
  }
  button.pill.ghost {
    min-height: 0;
    position: relative;
  }
  button.pill.ghost::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 44px;
    transform: translateY(-50%);
  }
  .pill.active {
    background: var(--rail-text);
    color: var(--white);
  }
</style>
