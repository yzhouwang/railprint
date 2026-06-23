<script lang="ts">
  interface Props {
    /** 0..100 */
    value: number;
    label?: string;
  }
  let { value, label }: Props = $props();
  const clamped = $derived(Math.max(0, Math.min(100, value)));
</script>

<div
  class="track"
  role="progressbar"
  aria-valuenow={Math.round(clamped)}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-label={label}
>
  <div class="fill" style:width={`${clamped}%`}></div>
</div>

<style>
  /* Thin emerald-600 fill on a mint track (DESIGN.md completion-stat card). */
  .track {
    height: 6px;
    width: 100%;
    background: var(--rail-bg);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--rail-lit);
    border-radius: var(--radius-pill);
    transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  }
</style>
