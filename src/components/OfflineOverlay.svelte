<script lang="ts">
  import { fade } from 'svelte/transition';
  import Icon from './Icon.svelte';
</script>

<!-- v0 is online-only: the map needs a connection, but cached stats stay readable
     (DESIGN.md interaction-state table). Covers the map region only. -->
<div class="overlay" transition:fade={{ duration: 150 }} role="status">
  <Icon name="info" size={28} />
  <p class="title">地図は接続が必要です</p>
  <p class="sub u-muted">記録と統計はオフラインでも閲覧できます</p>
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    text-align: center;
    padding: var(--space-xl);
    background: color-mix(in srgb, var(--rail-bg) 92%, transparent);
    color: var(--rail-text);
    z-index: 20;
  }
  .title {
    margin: var(--space-sm) 0 0;
    font-size: var(--size-stat);
    font-weight: var(--weight-label);
    color: var(--ink);
  }
  .sub {
    margin: 0;
    font-size: var(--size-body);
  }
</style>
