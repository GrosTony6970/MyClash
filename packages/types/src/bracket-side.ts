/**
 * The bracket slots the API sends, as every app reads them.
 *
 * The API declares these as the slots of its two bracket reads (the organiser's and the pad's
 * `getTournamentBracket`, the public `getPublishedBracket`), so a field renamed on the producer is
 * a compile error in the apps that type the answer with them. Types only: nothing here ships to a
 * page. It lives in its own subpath (`@myclash/types/bracket-side`) and not in the root barrel,
 * which ships to every page of every app.
 *
 * A side of a slot is a Fighter's Registration or a team (0282, ADR-022). `redSideId`,
 * `blueSideId` and `winnerSideId` are side keys (`sideKey`), built by the API. The Registration ids
 * stay beside them with the meaning they always had: null on a team side.
 */

/** One side of a bracket slot, a Fighter or a team. The wire sends `null` for a side not filled yet. */
export interface BracketSideWire {
  /** The side key (`sideKey`): the Registration id or the team id. */
  sideId: string;
  kind: 'individual' | 'team';
  /** The Fighter's Registration; null for a team. */
  registrationId: string | null;
  /** The team; null for a Fighter. */
  teamId: string | null;
  /** The side's label (`sideLabel`): the Fighter's name, or the team's. Null when not known, never ''. */
  name: string | null;
  /** The Fighter's club. A team has no club. */
  clubAbbrev: string | null;
  /** A team's colour name (`TOURNAMENT_COLORS`), or none. A Fighter has no colour. */
  colour: string | null;
}

/** One referee of a bracket bout, as the bracket card shows the chip. */
export interface BracketRefereeWire {
  /** A `referee_skills.id`, not a label. */
  role: string | null;
  roleLabel: string | null;
  displayName: string;
  status: string;
  /** Colour token of the role's skill. */
  skillColor: string;
}

/** One bracket slot, as both bracket reads send it. */
export interface BracketSlotWire {
  id: string;
  round: number;
  position: number;
  /** The bout's status; `scheduled` for a slot with no bout yet. */
  status: string;
  matchId: string | null;
  /** The side's label: the Fighter's name, or the team's. Null while the side is not filled. */
  redFighterName: string | null;
  blueFighterName: string | null;
  redClubAbbrev: string | null;
  blueClubAbbrev: string | null;
  redScore: number | null;
  blueScore: number | null;
  /** The Registration of a Fighter's side; null on a team side. */
  redRegistrationId: string | null;
  blueRegistrationId: string | null;
  /** The recorded winner's Registration; null when a team won. Read `winnerSideId`. */
  winnerRegistrationId: string | null;
  /** Side keys (`sideKey`): the Registration id or the team id, null while not known. */
  redSideId: string | null;
  blueSideId: string | null;
  /** The recorded winner, authoritative over the scores: a forfeit can win on the lower one. */
  winnerSideId: string | null;
  red: BracketSideWire | null;
  blue: BracketSideWire | null;
  source_a_ref: string | null;
  source_b_ref: string | null;
  liceName: string | null;
  referees: BracketRefereeWire[];
}

/** One bracket slot as the organiser's and the pad's bracket read sends it (`getTournamentBracket`). */
export interface TournamentBracketSlotWire extends BracketSlotWire {
  /** The bout's code (`buildRoundCode`), the name people see: `LSW-B-SF-M2`. Sent for an empty slot too. */
  roundCode: string;
  scheduledAt: string | null;
  liceId: string | null;
  source_a_type: string | null;
  source_b_type: string | null;
  registration_a_id: string | null;
  registration_b_id: string | null;
}
