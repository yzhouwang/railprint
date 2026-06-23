<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Text on the protruding manila-folder tab (rendered after a ■). */
    label: string;
    children: Snippet;
  }
  let { label, children }: Props = $props();
</script>

<!-- The signature folder-tab card: a small label chip protrudes top-left like a
     manila-folder tab carrying "■ label" (DESIGN.md signature component). -->
<section class="card">
  <span class="tab"><span class="mark" aria-hidden="true">■</span>{label}</span>
  <div class="body">
    {@render children()}
  </div>
</section>

<style>
  .card {
    position: relative;
    background: var(--white);
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-card);
    margin-top: 12px;
    box-shadow: 0 2px 10px rgba(26, 26, 26, 0.05);
  }
  .tab {
    position: absolute;
    top: -12px;
    left: 14px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 var(--space-md);
    border-radius: var(--radius-button) var(--radius-button) 0 0;
    background: var(--rail-bg);
    color: var(--rail-text);
    font-size: var(--size-label);
    font-weight: var(--weight-label);
    letter-spacing: 0.02em;
    border: 1px solid var(--rail-dim);
    border-bottom: none;
  }
  .mark {
    font-size: 8px;
    line-height: 1;
    color: var(--rail-lit);
  }
  .body {
    padding: var(--space-lg);
    padding-top: var(--space-lg);
  }
</style>
