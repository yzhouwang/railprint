<script lang="ts">
  import Diorama from './Diorama.svelte';
  import Button from './Button.svelte';
  import { goToTab, markMode } from '../lib/ui';

  // The cold-start hero: import is PRIMARY (fills the map instantly), mark is secondary
  // (DESIGN.md empty state). Sequencing decision: import is the v0 hero.
  function startImport(): void {
    goToTab('import');
  }
  function startMarking(): void {
    goToTab('map');
    markMode.set(true);
  }
</script>

<div class="empty">
  <Diorama variant="train" width={224} label="まだ記録がありません" />
  <h2 class="title">乗った路線を、地図に灯そう</h2>
  <p class="sub u-muted">
    乗りつぶしオンライン / RailLab の履歴を取り込むと、地図が一気に緑に染まります。
  </p>
  <div class="actions">
    <Button variant="primary" icon="import" onclick={startImport}>履歴を取り込む</Button>
    <Button variant="secondary" icon="plus" onclick={startMarking}>地図でマーク</Button>
  </div>
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-md);
    padding: var(--space-xxl) var(--space-xl);
    max-width: 420px;
    margin: 0 auto;
  }
  .title {
    margin: var(--space-sm) 0 0;
    font-size: 20px;
    font-weight: var(--weight-display);
    color: var(--ink);
  }
  .sub {
    margin: 0;
    font-size: var(--size-body);
    line-height: 1.6;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    width: 100%;
    max-width: 280px;
    margin-top: var(--space-sm);
  }
</style>
