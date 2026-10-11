/**
 * What the server's row says of its open round, for the pad's view of a bout's
 * rounds (`pad-series.ts`): its score, or "not scored yet".
 *
 * Pure: no store, no React. The caller gives the rows.
 */
import { getEffectiveMaxDoubles } from '@myclash/types';
import type { PadSeriesArgs, ServerRounds } from './pad-series';
import { provisionalDeltas } from './pending-events';

export const countsDown = (args: PadSeriesArgs) =>
  args.matchFormat.scoringDirection === 'reverse_zero_loses';

/**
 * The server's score of its open round, or null when it has not scored that
 * round yet.
 *
 * In a bout that counts down, 0-0 on a round in play has two meanings. "Not
 * scored yet": the row is made at 0-0, and both fighters hold the cap. Or
 * "both out of points": a true tie in a phase that cannot end level, or a bout
 * the doubles limit wiped that somebody put back in play.
 *
 * The sheet tells them apart, and only a sheet that EXPLAINS a 0-0 makes it
 * real: on the server's list of this round both fighters earned the cap or
 * more, or its doubles reach the limit of a format that wipes the board. The
 * server counts the score of a bout when it starts (`start-count.ts`) and of a
 * round when it opens, so such a round's row is at 0-0 for that reason.
 *
 * A hit on the list is NOT enough. The row and the list are separate reads,
 * and the tablet's copy of the row can be the one from before the Start while
 * the list already holds the first hit (a read of the row that failed on weak
 * wifi). Read as "both out of points", that row would close the round on the
 * tablet at the next unsent hit. Read as "not scored", it shows the cap and
 * the tablet's own hits, one hit behind the server until the row lands: the
 * known lag.
 *
 * A round that waits for "Start round", and a bout that is over, keep their
 * 0-0: it is that round's result.
 *
 * Read wrong, named: the list of hits is older than the row (its read failed).
 * A real 0-0 then reads cap to cap until the list lands. And the list is added
 * up as the tablet adds a hit (`provisionalDeltas`): a ruleset that gives every
 * hit one fixed value counts another way, and the server decides.
 */
export function serverScore(args: PadSeriesArgs): ServerRounds | null {
  const { server, matchFormat } = args;
  if (!countsDown(args) || server.awaitingRoundAdvance || server.over) return server;
  if (server.redScore !== 0 || server.blueScore !== 0) return server;
  // A row of the list with no round is of round 1: the server reads it so.
  const listed = args.exchanges.filter((row) => (row.round_number ?? 1) === server.currentRound);
  const earned = provisionalDeltas({
    exchanges: listed,
    penalties: [],
    redRegistrationId: args.redRegistrationId,
    blueRegistrationId: args.blueRegistrationId,
  });
  const bothOut = earned.red >= matchFormat.pointCap && earned.blue >= matchFormat.pointCap;
  const limit = getEffectiveMaxDoubles({ phaseType: args.phaseType }, matchFormat);
  const wiped =
    limit !== null &&
    matchFormat.maxDoubleHitOutcome !== 'result_stands' &&
    listed.filter((row) => row.type === 'double').length >= limit;
  return bothOut || wiped ? server : null;
}
