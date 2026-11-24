/**
 * The standings rows the API sends, as every app reads them.
 *
 * The API declares these as the `rows` of its pool-standings and Swiss-standings answers, so a
 * field renamed on the producer is a compile error in web-admin, web-public and web-staff. Types
 * only: a type-only import of the engine's row emits nothing, and nothing here ships to a page. It
 * lives in its own subpath (`@myclash/types/pool-standings`) and not in the root barrel, which
 * ships to every page of every app.
 *
 * `entrantId` is the key of the entrant a row is for: its side key (`sideKey`), a Registration id
 * in an individual Tournament, a team id in a team Tournament's Pools. Swiss has no team path.
 */
import type { StandingsRow } from '@myclash/rules/results';

/** What every standings row carries, pool or Swiss. */
export type StandingsWireRow = StandingsRow;

/**
 * One row of the pool-standings answer, with its side as `sideLabel` gives it (the API's one
 * owner of what a side is called): the data of a team's chip. A Fighter has no colour and no logo.
 */
export interface PoolStandingsRow extends StandingsWireRow {
  kind: 'individual' | 'team';
  /** One of the colour names of `TOURNAMENT_COLORS`, or none. */
  colour: string | null;
  logoUrl: string | null;
}

/** One row of the Swiss-standings answer: a withdrawal keeps its row (decision 11). */
export interface SwissStandingsWireRow extends StandingsWireRow {
  withdrawn: boolean;
  withdrawnAtRound: number | null;
}
