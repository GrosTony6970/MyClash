/**
 * The pad's view of a best-of bout: which round is open, and what counts in it.
 *
 * In a best-of bout the server counts by round: `matches.red_score` is the open
 * round's score, and the doubles limit is asked of the open round's doubles
 * (`recomputeBestOfRounds`). A surface that counts the whole bout disagrees
 * with the server from round 2 on. This is the one place the pad reads a round.
 *
 * Today it gives the doubles. The rest of the round's state (its score, the
 * rounds closed, the tally) is still read from the server's row by its
 * readers, and moves here with the rounds a tablet runs with no network.
 *
 * Pure: no store, no React. The caller gives the rows.
 */
import { getEffectiveMaxDoubles, type MatchFormatConfig, type PhaseType } from '@myclash/types';
import type { ExchangeRow } from '@myclash/ui';

export interface PadSeries {
  /** The open round: 1 in a single-round bout. */
  round: number;
  /** The doubles of the open round, the ones the tablet still holds included. */
  doubles: number;
  /** The doubles limit the server applies to this bout, or null for none. */
  doublesLimit: number | null;
}

export function padSeries(args: {
  isBestOf: boolean;
  phaseType: PhaseType | undefined;
  matchFormat: MatchFormatConfig;
  /** The server's open round. */
  currentRound: number;
  /** The server's rows, not voided. Each carries its round (`round_number`). */
  exchanges: readonly ExchangeRow[];
  /**
   * The rows the tablet still holds. They count in the open round: the server
   * gives a hit the round that is open when the hit ARRIVES, not the round of
   * the tap (`MatchesService.createExchange`).
   */
  queued: readonly ExchangeRow[];
}): PadSeries {
  const round = args.isBestOf ? args.currentRound : 1;
  // A row with no round is of round 1: the server reads it so (`?? 1`).
  const inRound = (row: ExchangeRow) => !args.isBestOf || (row.round_number ?? 1) === round;
  const double = (row: ExchangeRow) => row.type === 'double';
  return {
    round,
    doubles:
      args.exchanges.filter(inRound).filter(double).length + args.queued.filter(double).length,
    doublesLimit: getEffectiveMaxDoubles({ phaseType: args.phaseType }, args.matchFormat),
  };
}
