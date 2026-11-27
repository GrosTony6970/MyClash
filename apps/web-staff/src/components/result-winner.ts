/**
 * Who the result screen crowns: by side key, never by the higher score.
 *
 * The recorded winner is a Fighter's Registration or a team (`winner_registration_id`,
 * `winner_team_id`), and a forfeit or a `referee_decision` override can put it on the lower
 * score. While the tablet's own End is not confirmed, the winner is the leader it was pressed on.
 *
 * Pure, out of the component: web-staff has no React test setup.
 */
import { resolveMatchWinner } from '@myclash/types';
import { sideKey } from '@myclash/types/side-key';
import { sideIdOf, type BoutSides } from '../lib/bout-sides';
import { isDoubleLoss } from './is-double-loss';
import type { MatchInfo } from './MatchView';

/** The bout's two side keys and its winner's, the server's or the tablet's own. */
export function resultSides(
  match: BoutSides & Pick<MatchInfo, 'winnerRegistrationId' | 'winnerTeamId'>,
  own: { unconfirmed: boolean; winner: 'red' | 'blue' | null | undefined },
) {
  const redSideId = sideIdOf(match, 'red');
  const blueSideId = sideIdOf(match, 'blue');
  const ownWinnerId = own.winner === 'red' ? redSideId : own.winner === 'blue' ? blueSideId : null;
  const winnerSideId = own.unconfirmed
    ? ownWinnerId
    : sideKey(match.winnerRegistrationId, match.winnerTeamId);
  return { redSideId, blueSideId, winnerSideId };
}

/**
 * The corner the headline crowns, or null. A loss for both names nobody, whatever the board
 * reads: a card on a wiped board leaves 0 and -1, and its leader is not a winner.
 */
export function resultWinner(args: {
  resultReason: string | null;
  winnerSideId: string | null;
  redSideId: string | null;
  blueSideId: string | null;
  redScore: number;
  blueScore: number;
}): 'red' | 'blue' | null {
  if (isDoubleLoss('completed', args.resultReason)) return null;
  const { winnerSideId, redSideId, blueSideId, redScore, blueScore } = args;
  return resolveMatchWinner({
    status: 'completed', // the overlay only renders once the clock has ended
    winnerSideId,
    redSideId,
    blueSideId,
    redScore,
    blueScore,
  });
}
