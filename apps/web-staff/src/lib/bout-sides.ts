/**
 * Is a side of this bout still to come? A bracket bout can wait for a Fighter: a placeholder
 * with no side yet, or a bout whose other Fighter wins a bout still to fight. Such a bout takes
 * no Start, hit, card or colour swap (operator, 2026-11-24): the pad refuses them before the
 * server does (`bout_side_missing`).
 *
 * A side is judged by side, not by Registration (`sideKey`): a team's side has no Registration
 * and is known. A copy the tablet kept before the bout read carried the team ids has none, and
 * reads them as absent. Pure: the bout screen asks it of the bout it shows, the server's or the
 * tablet's copy.
 */
import { sideKey } from '@myclash/types';
import type { MatchInfo } from '../components/MatchView';

export function sideMissing(
  match: Pick<MatchInfo, 'redRegistrationId' | 'blueRegistrationId' | 'redTeamId' | 'blueTeamId'>,
): boolean {
  return (
    sideKey(match.redRegistrationId, match.redTeamId) === null ||
    sideKey(match.blueRegistrationId, match.blueTeamId) === null
  );
}
