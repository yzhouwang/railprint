// C9 — the rank → reveal-zoom (minz) table, extracted so both style.ts (layer expressions) and
// overlap.ts (braid partnersMinz stamping) can import it without an ESM cycle. Rank comes from
// RailLine.rank: 0 Shinkansen … 4 minor local.
export const RANK_MINZOOM = [3, 4, 5, 6, 7] as const;

export function minzForRank(rank: number | undefined): number {
  return rank == null ? 0 : (RANK_MINZOOM[rank] ?? 0);
}
