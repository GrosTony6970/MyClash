import { resolveMatchWinner } from '@myclash/types/match-winner';
import { sideKey } from '@myclash/types/side-key';

/** A Pool bout's sides, scores and recorded winner, as `pools-with-matches` sends them (0284). */
export interface PoolBoutResult {
  status: string;
  red_registration_id: string | null;
  blue_registration_id: string | null;
  red_team_id: string | null;
  blue_team_id: string | null;
  red_score: number | null;
  blue_score: number | null;
  winner_registration_id: string | null;
  winner_team_id: string | null;
}

/**
 * Which side of a Pool bout the table bolds: the RECORDED winner, by side key, so a team bout
 * (whose Registration columns are all null) names its winner too. A forfeit or a
 * `referee_decision` override can award the bout to the side behind on points.
 */
export function poolBoutWinner(m: PoolBoutResult): 'red' | 'blue' | null {
  return resolveMatchWinner({
    status: m.status,
    winnerRegistrationId: sideKey(m.winner_registration_id, m.winner_team_id),
    redRegistrationId: sideKey(m.red_registration_id, m.red_team_id),
    blueRegistrationId: sideKey(m.blue_registration_id, m.blue_team_id),
    redScore: m.red_score,
    blueScore: m.blue_score,
  });
}
