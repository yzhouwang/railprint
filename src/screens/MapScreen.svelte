<script lang="ts">
  // Mobile map composition: the full-bleed MapView + a floating completion StatCard.
  // The line-first marking UI (line picker → tap A → tap B) and the D5 flood + mark
  // pulse all live INSIDE MapView, so this screen is the thin mobile frame: map behind,
  // stat card floating at the bottom (DESIGN.md mobile: "stat card floats bottom").
  //
  // When the user enters mark mode the floating card steps aside so it never overlaps
  // the marking panel / blocks station taps near the bottom of the network.

  import MapView from './MapView.svelte';
  import CountryStatCards from '../components/CountryStatCards.svelte';
  import { markMode } from '../lib/ui';
</script>

<div class="map-screen">
  <MapView />

  {#if !$markMode}
    <div class="float-card">
      <CountryStatCards />
    </div>
  {/if}
</div>

<style>
  .map-screen {
    position: relative;
    height: 100%;
  }
  .float-card {
    position: absolute;
    /* sit above the FAB (which docks bottom-right above the 72px tab bar). */
    left: var(--space-md);
    right: var(--space-md);
    bottom: calc(72px + env(safe-area-inset-bottom, 0) + var(--space-sm));
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    /* let map drags through the gaps; the cards themselves stay interactive. */
    pointer-events: none;
    z-index: 20;
  }
  .float-card :global(.card) {
    pointer-events: auto;
  }
  /* keep the second (HSR) card from crowding the FAB on short screens. */
  @media (max-height: 560px) {
    .float-card :global(.card:nth-child(2)) {
      display: none;
    }
  }
</style>
