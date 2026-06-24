<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    active?: boolean;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  }
  let { active = false, onclick, children }: Props = $props();
</script>

{#if onclick}
  <button class="pill" class:active {onclick} aria-pressed={active}>
    {@render children()}
  </button>
{:else}
  <span class="pill" class:active>{@render children()}</span>
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
    min-height: 32px;
  }
  .pill.active {
    background: var(--rail-text);
    color: var(--white);
  }
</style>
