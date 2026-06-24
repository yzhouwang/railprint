<script lang="ts">
  import { activeTab, type Tab } from '../lib/ui';
  import Icon, { type IconName } from './Icon.svelte';

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'map', label: '地図', icon: 'map' },
    { id: 'stats', label: '統計', icon: 'stats' },
    { id: 'import', label: '取込', icon: 'import' },
  ];
</script>

<nav class="tabbar" aria-label="メインナビゲーション">
  {#each tabs as t (t.id)}
    <button
      class="tab"
      class:active={$activeTab === t.id}
      aria-current={$activeTab === t.id ? 'page' : undefined}
      onclick={() => activeTab.set(t.id)}
    >
      <Icon name={t.icon} size={22} />
      <span class="label">{t.label}</span>
    </button>
  {/each}
</nav>

<style>
  .tabbar {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    background: var(--white);
    border-top: 1px solid var(--rail-dim);
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  .tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-height: 56px;
    border: none;
    background: none;
    color: var(--ink-muted);
    font-size: var(--size-label);
    font-weight: var(--weight-label);
  }
  .tab.active {
    color: var(--rail-text);
  }
  .label {
    line-height: 1;
  }
</style>
