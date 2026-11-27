/**
 * The two sides of the bout on the pad: a Fighter's Registration or a team (ADR-022).
 *
 * The pad derives a side from the bout's four ids; it never stores a side key (call 9). A copy
 * the tablet kept before the bout read carried the team ids has none, and reads them as absent.
 * Pure: the bout screen asks it of the bout it shows, the server's or the tablet's copy.
 */
import { sideKey } from '@myclash/types/side-key';
import type { MatchInfo } from '../components/MatchView';
import type { QueuedSide } from '../offline/queued-side';

/** The ids a bout names its two sides by. */
export type BoutSides = Pick<
  MatchInfo,
  'redRegistrationId' | 'blueRegistrationId' | 'redTeamId' | 'blueTeamId'
>;

/**
 * One corner's side: its Fighter's Registration, or its team, or null while the side is still to
 * come (a bracket slot to fill). A card, a protest and a forfeit go to this side.
 */
export function sideOf(match: BoutSides, corner: 'red' | 'blue'): QueuedSide | null {
  const registrationId = corner === 'red' ? match.redRegistrationId : match.blueRegistrationId;
  const teamId = corner === 'red' ? match.redTeamId : match.blueTeamId;
  const id = sideKey(registrationId, teamId);
  if (id === null) return null;
  return registrationId ? { kind: 'registration', id } : { kind: 'team', id };
}

/**
 * One corner's side key (`sideKey`): the id of `sideOf`'s side, or null while the side is still
 * to come. The one place the pad builds a corner's key: the history, the rounds and the result
 * screen place rows and crown a winner by it.
 */
export function sideIdOf(match: BoutSides, corner: 'red' | 'blue'): string | null {
  return sideOf(match, corner)?.id ?? null;
}

/**
 * Is a side of this bout still to come? A bracket bout can wait for a Fighter: a placeholder
 * with no side yet, or a bout whose other Fighter wins a bout still to fight. Such a bout takes
 * no Start, hit, card or colour swap (operator, 2026-11-24): the pad refuses them before the
 * server does (`bout_side_missing`). A team's side has no Registration and is known.
 */
export function sideMissing(match: BoutSides): boolean {
  return sideOf(match, 'red') === null || sideOf(match, 'blue') === null;
}
