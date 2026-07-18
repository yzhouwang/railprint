<script lang="ts">
  // T5 — category train silhouettes for the 車両図鑑 (plan D12, design DD8/DD10).
  //
  // Claymation-diorama style (Diorama.svelte's visual language): rounded everything, toy
  // proportions, a soft ground shadow, white window glass. FIVE category shapes as the SVG
  // FALLBACK (D12); per-model raster art replaces them where curated (D21 stage 2, raster
  // branch below): shinkansen = long tapered nose · cn-hsr = rounded bullet nose + roof
  // pantograph nub · express = raked front, bigger windows · commuter = boxy + door
  // rectangles · dmu = boxy + roof exhaust stack.
  //
  // ── DD10 FILL RULE (LOUD — this trap was hit live during the mockup build) ──────────────
  // Body shape paths NEVER hardcode fill. The component sets fill ONCE on a wrapping <g>
  // ({fill ?? 'var(--dex-ghost-fill, #DCE5DF)'}) so the per-instance color cascades to every
  // body shape. Ghost/uncollected = OMIT the fill prop, which lands the ghost token default —
  // NEVER a stroke-outline restyle, because CSS cannot pierce <use>/shadow SVG content.
  // Decorative internals are exempt from the cascade: window glass fills white, wheels a
  // fixed neutral, shading bands a translucent ink. Accent hues are permitted HERE ONLY
  // (DD8 livery-is-data carve-out); all chrome around this component stays emerald-system.
  //
  // ── D21 stage-2 RASTER branch ────────────────────────────────────────────────────────
  // When `raster` (silhouettes.ts asset URL) is present it replaces the SVG entirely:
  // collected (fill set) = the WebP as a lazy <img> — the art carries its own livery, the
  // accent fill is NOT applied on top; ghost (fill omitted) = the SAME WebP as a CSS mask
  // over var(--dex-ghost-fill), which is the DD10 rule expressed in mask form. One asset,
  // both states. Both render inside the same 100:52 letterbox the SVG uses, so raster and
  // category cards keep an identical footprint in the grid.

  interface Props {
    variant: 'shinkansen' | 'cn-hsr' | 'express' | 'commuter' | 'dmu';
    /** Body fill (collected card = registry accentColor ?? var(--rail-lit)); OMIT for ghost.
     *  For raster art the VALUE is ignored — presence alone means collected (art carries
     *  its own livery); absence renders the ghost mask. */
    fill?: string;
    /** Fixed pixel width; omit to fill the parent (grid-card usage). */
    width?: number;
    /** Accessible name; omitted = decorative (aria-hidden). */
    label?: string;
    /** Per-model raster art URL (silhouettes.ts); when present it REPLACES the SVG. */
    raster?: string;
  }
  let { variant, fill, width, label, raster }: Props = $props();

  // Wheel x-positions per variant (wheels are decorative internals — fixed neutral fill).
  const WHEELS: Record<Props['variant'], [number, number]> = {
    shinkansen: [24, 64],
    'cn-hsr': [24, 62],
    express: [22, 62],
    commuter: [20, 80],
    dmu: [24, 76],
  };
</script>

{#if raster}
  <div
    class="sil ras"
    class:fluid={width === undefined}
    style:width={width !== undefined ? `${width}px` : undefined}
    role={label ? 'img' : undefined}
    aria-label={label || undefined}
    aria-hidden={label ? undefined : 'true'}
  >
    {#if fill}
      <img src={raster} alt="" loading="lazy" decoding="async" />
    {:else}
      <div class="mask" style:--sil-mask="url('{raster}')"></div>
    {/if}
  </div>
{:else}
<svg
  class="sil"
  class:fluid={width === undefined}
  {width}
  viewBox="0 0 100 52"
  role={label ? 'img' : undefined}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : 'true'}
>
  <!-- soft ground shadow, shared by all variants (outside the fill cascade) -->
  <ellipse cx="50" cy="47.5" rx="40" ry="3" fill="#1A1A1A" opacity="0.06" />

  <!-- DD10: the ONE place fill is set; every un-filled shape below inherits it -->
  <g fill={fill ?? 'var(--dex-ghost-fill, #DCE5DF)'}>
    {#if variant === 'shinkansen'}
      <!-- long tapered nose to the right -->
      <path d="M6 29 q0 -3 3 -3 H54 q28 0 34 13 l1.2 2.8 q1.3 3.2 -2.7 3.2 H9 q-3 0 -3 -3 Z" />
      <rect x="6" y="41.4" width="84" height="2.6" rx="1.3" fill="#1A1A1A" opacity="0.12" />
      <path d="M70 29.5 q9 1.6 13.3 7.5 h-8.3 q-2.6 0 -3.6 -2.6 Z" fill="var(--white)" opacity="0.92" />
      <rect x="12" y="31" width="9" height="5" rx="2.5" fill="var(--white)" />
      <rect x="25" y="31" width="9" height="5" rx="2.5" fill="var(--white)" />
      <rect x="38" y="31" width="9" height="5" rx="2.5" fill="var(--white)" />
    {:else if variant === 'cn-hsr'}
      <!-- rounded bullet nose + roof pantograph nub (inherits the body fill) -->
      <rect x="24" y="19.5" width="10" height="6" rx="2.5" />
      <path d="M6 30 q0 -4 4 -4 H52 q24 0 31 12.5 q2.6 5.5 -2.4 5.5 H10 q-4 0 -4 -4 Z" />
      <rect x="6" y="40.4" width="80" height="2.4" rx="1.2" fill="#1A1A1A" opacity="0.12" />
      <rect x="12" y="30" width="34" height="5.5" rx="2.75" fill="var(--white)" />
      <path d="M66 29 q10 1.8 14.6 8.4 h-9 q-2.8 0 -3.8 -2.8 Z" fill="var(--white)" opacity="0.92" />
    {:else if variant === 'express'}
      <!-- raked front, bigger windows -->
      <path d="M6 27 q0 -3 3 -3 H68 q6.5 0 8.8 6 l4.4 11.2 q1.2 3.3 -2.8 3.3 H9 q-3 0 -3 -3 Z" />
      <rect x="6" y="41.2" width="72" height="2.4" rx="1.2" fill="#1A1A1A" opacity="0.12" />
      <path d="M70 24.8 q4.6 0.6 6.4 5.2 l1.6 4.2 h-7.6 Z" fill="var(--white)" opacity="0.92" />
      <rect x="12" y="28" width="10" height="7" rx="2.5" fill="var(--white)" />
      <rect x="26" y="28" width="10" height="7" rx="2.5" fill="var(--white)" />
      <rect x="40" y="28" width="10" height="7" rx="2.5" fill="var(--white)" />
    {:else if variant === 'commuter'}
      <!-- boxy body + door rectangles -->
      <rect x="5" y="23" width="90" height="21" rx="5.5" />
      <rect x="5.5" y="40.8" width="89" height="2.4" rx="1.2" fill="#1A1A1A" opacity="0.12" />
      <rect x="24" y="27" width="8.5" height="16" rx="2.5" fill="var(--white)" opacity="0.92" />
      <rect x="63" y="27" width="8.5" height="16" rx="2.5" fill="var(--white)" opacity="0.92" />
      <rect x="10.5" y="28" width="9" height="5.5" rx="2" fill="var(--white)" />
      <rect x="36.5" y="28" width="9" height="5.5" rx="2" fill="var(--white)" />
      <rect x="49.5" y="28" width="9" height="5.5" rx="2" fill="var(--white)" />
      <rect x="75.5" y="28" width="9" height="5.5" rx="2" fill="var(--white)" />
    {:else}
      <!-- dmu: boxy body + roof exhaust stack (+ a soft exhaust puff) -->
      <rect x="58" y="16.5" width="6.5" height="9" rx="2.5" />
      <circle cx="61.5" cy="12.5" r="3.6" fill="#1A1A1A" opacity="0.08" />
      <rect x="8" y="24" width="84" height="20" rx="5.5" />
      <rect x="8.5" y="40.8" width="83" height="2.4" rx="1.2" fill="#1A1A1A" opacity="0.12" />
      <rect x="46" y="28" width="8" height="15" rx="2.5" fill="var(--white)" opacity="0.92" />
      <rect x="14" y="28.5" width="8.5" height="5.5" rx="2" fill="var(--white)" />
      <rect x="26" y="28.5" width="8.5" height="5.5" rx="2" fill="var(--white)" />
      <rect x="60" y="28.5" width="8.5" height="5.5" rx="2" fill="var(--white)" />
      <rect x="72" y="28.5" width="8.5" height="5.5" rx="2" fill="var(--white)" />
    {/if}

    <!-- wheels: fixed neutral (decorative internals, exempt from the DD10 cascade) -->
    {#each WHEELS[variant] as cx (cx)}
      <circle {cx} cy="45" r="4" fill="#39413C" />
      <circle {cx} cy="45" r="1.5" fill="var(--white)" opacity="0.55" />
    {/each}
  </g>
</svg>
{/if}

<style>
  .sil {
    display: block;
    height: auto;
  }
  .sil.fluid {
    width: 100%;
  }
  /* raster letterbox: same 100:52 footprint as the SVG viewBox, art contained inside */
  .ras {
    aspect-ratio: 100 / 52;
  }
  .ras img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .ras .mask {
    width: 100%;
    height: 100%;
    background-color: var(--dex-ghost-fill, #DCE5DF);
    -webkit-mask: var(--sil-mask) center / contain no-repeat;
    mask: var(--sil-mask) center / contain no-repeat;
  }
</style>
