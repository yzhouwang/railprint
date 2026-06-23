<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { toasts, dismissToast } from '../lib/ui';
  import Icon, { type IconName } from './Icon.svelte';

  const icons: Record<string, IconName> = { success: 'check', info: 'info', error: 'alert' };
</script>

<!-- Monochrome by design: success = emerald, info/error = ink (no second hue);
     error is distinguished by the alert glyph, not color (DESIGN.md). -->
<!-- Each toast owns its own live semantics (role=status / role=alert), so the container
     must NOT also be a live region or screen readers double-announce. -->
<div class="stack">
  {#each $toasts as t (t.id)}
    <div
      class="toast {t.kind}"
      role={t.kind === 'error' ? 'alert' : 'status'}
      in:fly={{ y: 16, duration: 200 }}
      out:fade={{ duration: 150 }}
    >
      <Icon name={icons[t.kind]} size={18} />
      <span class="msg">{t.message}</span>
      <button class="x" aria-label="閉じる" onclick={() => dismissToast(t.id)}>
        <Icon name="close" size={16} />
      </button>
    </div>
  {/each}
</div>

<style>
  .stack {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(72px + env(safe-area-inset-bottom, 0));
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    z-index: 60;
    width: min(440px, calc(100vw - 32px));
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-md) var(--space-lg);
    border-radius: var(--radius-button);
    font-size: var(--size-body);
    font-weight: var(--weight-label);
    box-shadow: 0 6px 22px rgba(26, 26, 26, 0.22);
  }
  .toast.success {
    background: var(--rail-text);
    color: var(--white);
  }
  .toast.info,
  .toast.error {
    background: var(--ink);
    color: var(--white);
  }
  .msg {
    flex: 1;
  }
  .x {
    display: inline-flex;
    background: none;
    border: none;
    color: inherit;
    opacity: 0.8;
    padding: 0;
  }
</style>
