/**
 * The standings rows and the Pool seats the API sends, as every app reads them.
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

/**
 * One entrant of a Pool, a Fighter or a team (0282, ADR-022), as every seat the API sends names
 * it. The API declares these as its producers' return types, so a field renamed there is a compile
 * error in the screens that read it.
 */
export interface SideSeat {
  /** The side key (`sideKey`): the Registration id or the team id. Never null: a seat names one. */
  sideId: string;
  kind: 'individual' | 'team';
  /** The Registration of a Fighter's seat; null for a team's, never a team id. */
  registrationId: string | null;
  /** The Fighter's club. A team has no club. */
  clubLabel: string | null;
  /** A team's colour name (`TOURNAMENT_COLORS`), or none. A Fighter has no colour. */
  colour: string | null;
  logoUrl: string | null;
}

/** One entrant as the Pools page lists it, in a Pool or waiting for one (`poolSeatOf`). */
export interface PoolSeat extends SideSeat {
  /** The side's label: the Fighter's name, or the team's. */
  name: string;
  /** The Fighter's name; null for a team, which is not a person: read `name`. */
  personName: string | null;
  /** A Fighter's weighted HEMA rating; null for a team, which has no rating (decision 13). */
  hemaWeightedRating: number | null;
}

/** One seat of a Pool as the referee assignment board lists it. */
export interface AssignmentBoardMember extends SideSeat {
  /**
   * The Fighter's `global_persons.id`, the id the referee candidates carry, so rule 8 can tell a
   * Fighter from a referee; blank for a team's seat, which has no Person.
   */
  personId: string;
  /** The Fighter's name, or the team's. */
  personName: string;
}

/** One row of the Swiss-standings answer: a withdrawal keeps its row (decision 11). */
export interface SwissStandingsWireRow extends StandingsWireRow {
  withdrawn: boolean;
  withdrawnAtRound: number | null;
}
