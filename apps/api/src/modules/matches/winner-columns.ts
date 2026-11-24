import { sidesOf } from './bout-sides';

/** The two columns of each side of a bout: a Registration or a team, never both (0282). */
export type SideColumns = {
  red_registration_id: string | null;
  red_team_id: string | null;
  blue_registration_id: string | null;
  blue_team_id: string | null;
};

/**
 * The winner the engine names, as the columns a bout row stores it in.
 *
 * The engine names a side by its key (`sideKey`). A Registration wins into
 * `winner_registration_id`, a team into `winner_team_id`, and the other column is cleared, so a
 * row never names two winners. No winner clears both. A key that is neither side of the bout is
 * a fault, and nothing is written: a bout with no side has no side to win.
 */
export function winnerColumns(
  row: SideColumns,
  winnerSideId: string | null,
): { winner_registration_id: string | null; winner_team_id: string | null } {
  if (winnerSideId === null) return { winner_registration_id: null, winner_team_id: null };
  const sides = sidesOf(row);
  let registrationId: string | null;
  let teamId: string | null;
  if (winnerSideId === sides.red) {
    registrationId = row.red_registration_id;
    teamId = row.red_team_id;
  } else if (winnerSideId === sides.blue) {
    registrationId = row.blue_registration_id;
    teamId = row.blue_team_id;
  } else {
    throw new Error(`The winner ${winnerSideId} is neither side of the bout`);
  }
  return { winner_registration_id: registrationId, winner_team_id: teamId };
}
