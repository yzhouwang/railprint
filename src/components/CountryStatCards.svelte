<script lang="ts">
  // Per-country completion StatCards — ONE source so desktop (App.svelte), mobile (MapScreen),
  // and the stats screen (StatsScreen) never drift back into a misleading blended "全国 %" that
  // mixes Japan + China. Japan's figure is Japan's alone; a 中国 card appears once you've ridden
  // in China. km/prefecture totals elsewhere stay cross-country — those are sums, not percentages.
  import StatCard from './StatCard.svelte';
  import { headline } from '../lib/store';

  const jp = $derived($headline.byCountry.JP);
  const cn = $derived($headline.byCountry.CN);
</script>

{#if jp}
  <StatCard pct={jp.pctNational} riddenKm={jp.riddenKm} caption="日本 全国" />
  {#if jp.hsrTotalKm > 0}
    <StatCard label="新幹線" pct={jp.pctHSR} riddenKm={jp.hsrRiddenKm} caption="高速鉄道" />
  {/if}
{/if}
{#if cn && cn.riddenKm > 0}
  <StatCard label="中国" pct={cn.pctNational} riddenKm={cn.riddenKm} caption="高速鉄道" />
{/if}
