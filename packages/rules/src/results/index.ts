/**
 * @myclash/rules/results — turning what happened into an order.
 *
 * Pool and Swiss standings, the tiebreak chains that break them, and the
 * promotion step that reads a ranking and decides who enters a bracket where.
 * Every function here is pure: it is handed rows and hands back rows.
 *
 * This is a SUBPATH, not part of the root barrel, for the same reason
 * `./scheduling` is one. `@myclash/types` re-exports the root, `packages/ui`
 * imports `@myclash/types`, and all three apps bundle `packages/ui` — so a
 * value on the root barrel ships to every client. No client ranks a Pool.
 *
 * What did NOT come across from `apps/api`: the PostgREST embed shapes. A row
 * spelled `pool_members` / `registration_id` is a database projection, and
 * mapping it belongs in the API adapter.
 */
export { applyRanking } from './standings';
export type { DecidingTiebreak, StandingsRow } from './standings';

export { buildSwissRankingChain, headToHeadWithin, opponentTiebreaks } from './swiss-tiebreaks';
export type { OpponentTiebreaks, SwissOutcome, SwissResultRecord } from './swiss-tiebreaks';

export {
  buildCrossPoolSnakeRanking,
  buildR1SeedingPlan,
  diffR1SeedingPlan,
  parseSeed,
  seedingSourceKind,
} from './bracket-r1-seeding';
export type {
  BracketR1Slot,
  PoolRanking,
  RankedRegistration,
  SlotSeedUpdate,
} from './bracket-r1-seeding';

export { rankByRating, rankBySeed, rankRandom } from './r1-ranking';
export type { SeedableRegistration } from './r1-ranking';
