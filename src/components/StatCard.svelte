<script lang="ts">
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import FolderTabCard from './FolderTabCard.svelte';
  import ProgressBar from './ProgressBar.svelte';

  interface Props {
    label?: string;
    /** 0..100 — rounded for display here (resolver returns full precision). */
    pct: number;
    riddenKm: number;
    /** muted sub-line context, e.g. "全国" or "新幹線" or "JR全線". */
    caption?: string;
  }
  let { label = '達成率', pct, riddenKm, caption = '全国' }: Props = $props();

  // Motion beat #1/#2 (DESIGN.md): the % and km tick up to value rather than snapping.
  // A JS rAF tween isn't covered by the global reduced-motion CSS, so gate it here too.
  const reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = reducedMotion ? 0 : 700;
  const tickPct = tweened(0, { duration: dur, easing: cubicOut });
  const tickKm = tweened(0, { duration: dur, easing: cubicOut });
  $effect(() => void tickPct.set(pct));
  $effect(() => void tickKm.set(riddenKm));
</script>

<FolderTabCard {label}>
  <div class="hero">
    <span class="pct u-display">{Math.round($tickPct)}<span class="unit">%</span></span>
    <span class="sub u-muted">{Math.round($tickKm).toLocaleString()} km · {caption}</span>
  </div>
  <ProgressBar value={pct} label={`${label} ${Math.round(pct)}%`} />
</FolderTabCard>

<style>
  .hero {
    display: flex;
    align-items: baseline;
    gap: var(--space-md);
    margin-bottom: var(--space-md);
    flex-wrap: wrap;
  }
  .pct {
    font-size: var(--size-pct-hero);
  }
  .unit {
    font-size: 0.6em;
    margin-left: 2px;
  }
  .sub {
    font-size: var(--size-stat);
    font-weight: var(--weight-label);
  }
</style>
