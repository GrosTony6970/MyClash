/**
 * The standings rows the API sends, as every app reads them.
 *
 * The API declares these as the `rows` of its pool-standings and Swiss-standings answers, so a
 * field renamed on the producer is a compile error in web-admin, web-public and web-staff. Types
 * only: a type-only import of the engine's row emits nothing, and nothing here ships to a page. It
 * lives in its own subpath (`@myclash/types/pool-standings`) and not in the root barrel, which
 * ships to every page of every app.
 *
 * `entrantId` is the key of the entrant a row is for. Today that is a Registration id, because
 * only individual Tournaments have standings.
 */
import type { StandingsRow } from '@myclash/rules/results';

/** What every standings row carries, pool or Swiss. */
export type StandingsWireRow = StandingsRow;

/** One row of the pool-standings answer. */
export type PoolStandingsRow = StandingsWireRow;

/** One row of the Swiss-standings answer: a withdrawal keeps its row (decision 11). */
export interface SwissStandingsWireRow extends StandingsWireRow {
  withdrawn: boolean;
  withdrawnAtRound: number | null;
}
