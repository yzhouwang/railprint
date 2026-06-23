<script lang="ts">
  // Soft, toy-like "claymation diorama" rendered as inline SVG so v0 ships no binary
  // art (DESIGN.md defers custom per-model art). Warm, rounded, emerald/mint/ink —
  // never stock-photo. Used by the empty state + Wrapped hero.
  interface Props {
    variant?: 'train' | 'board';
    width?: number;
    label?: string;
  }
  let { variant = 'train', width = 200, label = '' }: Props = $props();
</script>

<svg
  class="diorama"
  {width}
  viewBox="0 0 200 150"
  role="img"
  aria-label={label || (variant === 'train' ? '新幹線のジオラマ' : '発車標のジオラマ')}
>
  <!-- mint slab + soft ground shadow -->
  <ellipse cx="100" cy="132" rx="78" ry="9" fill="#000" opacity="0.06" />
  <rect x="14" y="116" width="172" height="22" rx="11" fill="var(--rail-bg)" />

  {#if variant === 'train'}
    <!-- toy Shinkansen, rounded long nose to the right -->
    <path
      d="M28 70 H150 q40 0 40 26 v6 q0 6 -6 6 H28 q-6 0 -6 -6 V76 q0 -6 6 -6 Z"
      fill="var(--rail-lit)"
    />
    <path d="M150 70 q40 0 40 26 h-40 Z" fill="var(--rail-text)" opacity="0.85" />
    <rect x="28" y="92" width="156" height="7" rx="3.5" fill="var(--rail-text)" />
    <!-- windows -->
    {#each [40, 62, 84, 106, 128] as x (x)}
      <rect {x} y="78" width="15" height="10" rx="3" fill="var(--white)" />
    {/each}
    <!-- wheels -->
    <circle cx="58" cy="116" r="9" fill="var(--ink)" />
    <circle cx="120" cy="116" r="9" fill="var(--ink)" />
    <circle cx="58" cy="116" r="3.4" fill="var(--rail-bg)" />
    <circle cx="120" cy="116" r="3.4" fill="var(--rail-bg)" />
  {:else}
    <!-- departure board on a post -->
    <rect x="92" y="78" width="8" height="42" rx="3" fill="var(--ink-muted)" />
    <rect x="40" y="30" width="120" height="54" rx="10" fill="var(--ink)" />
    {#each [42, 56, 70] as y (y)}
      <rect x="52" {y} width="64" height="6" rx="3" fill="var(--rail-lit)" opacity="0.9" />
      <rect x="124" {y} width="24" height="6" rx="3" fill="var(--rail-bg)" opacity="0.7" />
    {/each}
  {/if}
</svg>

<style>
  .diorama {
    display: block;
    height: auto;
  }
</style>
