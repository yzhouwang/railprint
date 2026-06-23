<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';

  interface Props {
    variant?: 'primary' | 'secondary';
    type?: 'button' | 'submit';
    disabled?: boolean;
    full?: boolean;
    icon?: IconName;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  }
  let {
    variant = 'primary',
    type = 'button',
    disabled = false,
    full = false,
    icon,
    onclick,
    children,
  }: Props = $props();
</script>

<button class="btn {variant}" class:full {type} {disabled} {onclick}>
  {#if icon}<Icon name={icon} size={18} />{/if}
  <span>{@render children()}</span>
</button>

<style>
  /* Primary = emerald-800 fill + white (≈5:1 on white). Secondary = emerald-800 outline.
     emerald-800 (--rail-text) for white-on-emerald passes AA (DESIGN.md). */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    min-height: 44px;
    padding: 0 var(--space-lg);
    border-radius: var(--radius-button);
    font-size: var(--size-stat);
    font-weight: var(--weight-label);
    border: 2px solid transparent;
    transition: transform 0.08s ease, background 0.15s ease, opacity 0.15s ease;
  }
  .btn:active:not(:disabled) {
    transform: scale(0.98);
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .primary {
    background: var(--rail-text);
    color: var(--white);
  }
  .secondary {
    background: var(--white);
    color: var(--rail-text);
    border-color: var(--rail-text);
  }
  .full {
    width: 100%;
  }
</style>
