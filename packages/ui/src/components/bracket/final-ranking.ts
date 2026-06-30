/**
 * Final-ranking computation moved to `@myclash/types` so framework-agnostic
 * consumers (the API's fighter-career placements) can share the exact same
 * ordering as the admin + public bracket pages. Re-exported here to keep the
 * `@myclash/ui` surface (`computeFinalRanking` + types) unchanged.
 */
export {
  computeFinalRanking,
  type RankingSlot,
  type PoolEntry,
  type FinalRankingEntry,
  type FinalRankingResultKind,
} from '@myclash/types';
