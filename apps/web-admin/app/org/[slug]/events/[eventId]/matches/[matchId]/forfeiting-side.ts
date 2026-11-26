import { sideKey } from '@myclash/types/side-key';

/** The four ids a bout's row names its two sides by, as `GET matches/:id` hands them. */
export interface BoutSideColumns {
  red_registration_id?: string | null;
  blue_registration_id?: string | null;
  red_team_id?: string | null;
  blue_team_id?: string | null;
}

/**
 * The side a forfeit or an override names: exactly one of the two fields (call 8). A team has no
 * Fighter status, so the form asks no "can continue?" for it, and the server refuses the answer
 * on a team's forfeit (call 4).
 */
export type ForfeitingSide =
  | { kind: 'registration'; body: { forfeitingRegistrationId: string } }
  | { kind: 'team'; body: { forfeitingTeamId: string } };

/**
 * One corner's side: its Fighter's Registration, or its team, or null while the side is still to
 * come (a bracket slot to fill). Built from the row through `sideKey`, as the pad's `sideOf`.
 */
export function forfeitingSide(
  bout: BoutSideColumns,
  corner: 'red' | 'blue',
): ForfeitingSide | null {
  const registrationId = corner === 'red' ? bout.red_registration_id : bout.blue_registration_id;
  const teamId = corner === 'red' ? bout.red_team_id : bout.blue_team_id;
  const id = sideKey(registrationId, teamId);
  if (id === null) return null;
  return registrationId
    ? { kind: 'registration', body: { forfeitingRegistrationId: id } }
    : { kind: 'team', body: { forfeitingTeamId: id } };
}
