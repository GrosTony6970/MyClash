/**
 * The side the piste's Pool list bolds as the winner of a bout.
 *
 * The RECORDED winner, never the higher score — a forfeit or a `referee_decision` override can
 * award the bout to the side behind on points, and this list is the piste operator's copy of the
 * organiser's Matches tab, so the two have to agree. Sides by side key: a team bout's sides and
 * winner are teams (`winner_team_id`).
 *
 * Pure, out of the component: web-staff has no React test setup.
 */
import { resolveMatchWinner } from '@myclash/types';
import { sideKey } from '@myclash/types/side-key';
import type { PoolMatchRow } from '../components/tournament-context-types';

export function poolRowWinner(match: PoolMatchRow): 'red' | 'blue' | null {
  return resolveMatchWinner({
    status: match.status,
    winnerSideId: sideKey(match.winner_registration_id, match.winner_team_id),
    redSideId: sideKey(match.red_registration_id, match.red_team_id),
    blueSideId: sideKey(match.blue_registration_id, match.blue_team_id),
    redScore: match.red_score,
    blueScore: match.blue_score,
  });
}
