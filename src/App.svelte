<script lang="ts">
  import { ready, offline, headline, dataDegraded } from './lib/store';
  import { activeTab, markMode, type Tab } from './lib/ui';
  import { isDesktop } from './lib/media';

  import TabBar from './components/TabBar.svelte';
  import Fab from './components/Fab.svelte';
  import Toasts from './components/Toasts.svelte';
  import OfflineOverlay from './components/OfflineOverlay.svelte';
  import EmptyState from './components/EmptyState.svelte';
  import CountryStatCards from './components/CountryStatCards.svelte';
  import Icon, { type IconName } from './components/Icon.svelte';

  import MapView from './screens/MapView.svelte';
  import MapScreen from './screens/MapScreen.svelte';
  import StatsScreen from './screens/StatsScreen.svelte';
  import ImportScreen from './screens/ImportScreen.svelte';

  // Cold-start hero everywhere except the place you fix it (the import tab).
  const showEmpty = $derived(!$headline.hasRides && $activeTab !== 'import');

  function toggleMark(): void {
    activeTab.set('map');
    markMode.update((m) => !m);
  }

  const navItems: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'map', label: '地図', icon: 'map' },
    { id: 'stats', label: '統計', icon: 'stats' },
    { id: 'import', label: '取込', icon: 'import' },
  ];
</script>

{#if !$ready}
  <div class="splash">
    <span class="u-display">RailPrint</span>
    <span class="splash-load u-muted">鉄道網を読み込み中…</span>
  </div>
{:else if $isDesktop}
  <!-- D6: full-bleed map + persistent side panel (NOT a stretched mobile layout). -->
  <div class="desktop">
    <aside class="panel">
      <div class="brand"><span class="mark" aria-hidden="true">■</span>RailPrint</div>
      <nav class="dnav" aria-label="メインナビゲーション">
        {#each navItems as t (t.id)}
          <button
            class="dtab"
            class:active={$activeTab === t.id}
            aria-current={$activeTab === t.id ? 'page' : undefined}
            onclick={() => activeTab.set(t.id)}
          >
            <Icon name={t.icon} size={18} /><span>{t.label}</span>
          </button>
        {/each}
      </nav>
      <div class="panel-body">
        {#if $activeTab === 'stats'}
          <StatsScreen />
        {:else if $activeTab === 'import'}
          <ImportScreen />
        {:else}
          <CountryStatCards />
          <p class="hint u-muted">路線を選び、地図上で駅Aと駅Bをタップして記録します。</p>
        {/if}
      </div>
    </aside>
    <main class="map-pane">
      <MapView />
      {#if $offline}<OfflineOverlay />{/if}
      <div class="fab-dock"><Fab label="区間をマーク" active={$markMode} onclick={toggleMark} /></div>
    </main>
  </div>
{:else}
  <!-- Mobile: one screen at a time, bottom tab bar, FAB above it. -->
  <div class="mobile">
    <main class="screen">
      {#if showEmpty}
        <EmptyState />
      {:else if $activeTab === 'map'}
        <MapScreen />
        {#if $offline}<OfflineOverlay />{/if}
      {:else if $activeTab === 'stats'}
        <StatsScreen />
      {:else}
        <ImportScreen />
      {/if}
    </main>
    {#if $activeTab === 'map' && !showEmpty}
      <div class="fab-dock mobile-fab"><Fab label="区間をマーク" active={$markMode} onclick={toggleMark} /></div>
    {/if}
    <TabBar />
  </div>
{/if}

{#if $ready && $dataDegraded}
  <!-- Stub fallback while the real network failed to load: the user has saved rides that
       won't resolve here, so coverage is degraded, NOT zero. Reassure + auto-retries online. -->
  <div class="degraded" role="status">
    鉄道網データを読み込めませんでした。記録は保存されています。接続が戻り次第、自動で再試行します。
  </div>
{/if}

<!-- The map has its own OfflineOverlay; the stats/import screens had no offline signal at all,
     so importing while offline silently failed. Surface a strip there (skip when degraded already
     shows the stronger message, and skip the map tab which has the overlay). -->
{#if $ready && $offline && !$dataDegraded && $activeTab !== 'map'}
  <div class="offline-strip" role="status">オフライン — データの取得は接続が戻ると再開します。</div>
{/if}

<Toasts />

<style>
  .splash {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    align-items: center;
    justify-content: center;
    background: var(--rail-bg);
  }
  .splash .u-display {
    font-size: 28px;
  }
  .splash-load {
    font-size: var(--size-label);
  }
  .degraded {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 60;
    padding: 8px var(--space-md);
    text-align: center;
    font-size: var(--size-label);
    background: var(--rail-text);
    color: var(--white);
  }
  .offline-strip {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 60;
    padding: 8px var(--space-md);
    text-align: center;
    font-size: var(--size-label);
    background: var(--ink);
    color: var(--white);
  }

  /* ── mobile ── */
  .mobile {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .screen {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .mobile-fab {
    position: fixed;
    right: var(--space-lg);
    bottom: calc(72px + env(safe-area-inset-bottom, 0));
    z-index: 40;
  }

  /* ── desktop ── */
  .desktop {
    display: grid;
    grid-template-columns: 380px 1fr;
    height: 100%;
  }
  .panel {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--rail-dim);
    background: var(--white);
    overflow-y: auto;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-lg);
    font-size: 20px;
    font-weight: var(--weight-display);
    color: var(--ink);
  }
  .brand .mark {
    color: var(--rail-lit);
    font-size: 12px;
  }
  .dnav {
    display: flex;
    gap: var(--space-xs);
    padding: 0 var(--space-lg) var(--space-md);
  }
  .dtab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px var(--space-md);
    border: 1px solid var(--rail-dim);
    border-radius: var(--radius-pill);
    background: var(--white);
    color: var(--ink-muted);
    font-size: var(--size-label);
    font-weight: var(--weight-label);
  }
  .dtab.active {
    background: var(--rail-text);
    color: var(--white);
    border-color: var(--rail-text);
  }
  .panel-body {
    flex: 1;
    padding: var(--space-md) var(--space-lg) var(--space-xl);
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }
  .hint {
    font-size: var(--size-body);
    line-height: 1.6;
  }
  .map-pane {
    position: relative;
    min-width: 0;
  }
  .fab-dock {
    position: absolute;
    right: var(--space-xl);
    bottom: var(--space-xl);
    z-index: 40;
  }
</style>
