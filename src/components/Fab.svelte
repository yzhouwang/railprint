<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';

  interface Props {
    label: string;
    icon?: IconName;
    active?: boolean;
    onclick?: (e: MouseEvent) => void;
  }
  let { label, icon = 'plus', active = false, onclick }: Props = $props();
</script>

<button class="fab" class:active aria-label={label} aria-pressed={active} {onclick}>
  <Icon name={active ? 'close' : icon} size={26} />
</button>

<style>
  /* The "mark a ride" FAB — emerald-600 fill, floats above the tab bar (DESIGN.md). */
  .fab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: var(--radius-pill);
    background: var(--rail-lit);
    color: var(--white);
    border: none;
    box-shadow: 0 6px 18px rgba(0, 160, 64, 0.36);
    transition: transform 0.08s ease, background 0.15s ease;
  }
  .fab:active {
    transform: scale(0.96);
  }
  .fab.active {
    background: var(--rail-text);
  }
</style>
