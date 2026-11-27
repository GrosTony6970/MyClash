import type { BracketSideWire, TournamentBracketSlotWire } from '@myclash/types/bracket-side';

/** A team Tournament's bracket, as the bracket read sends it (`page.team.test.tsx`). */

export const team = (teamId: string, name: string, colour: string): BracketSideWire => ({
  sideId: teamId,
  kind: 'team',
  registrationId: null,
  teamId,
  name,
  clubAbbrev: null,
  colour,
});

const slot = (
  id: string,
  red: BracketSideWire,
  blue: BracketSideWire,
  over: Partial<TournamentBracketSlotWire> = {},
): TournamentBracketSlotWire => ({
  id,
  round: 1,
  position: 1,
  roundCode: 'LSW-B-F-M1',
  status: 'scheduled',
  matchId: 'm1',
  redFighterName: red.name,
  blueFighterName: blue.name,
  redClubAbbrev: null,
  blueClubAbbrev: null,
  redScore: null,
  blueScore: null,
  redRegistrationId: null,
  blueRegistrationId: null,
  winnerRegistrationId: null,
  redSideId: red.sideId,
  blueSideId: blue.sideId,
  winnerSideId: null,
  red,
  blue,
  source_a_ref: null,
  source_b_ref: null,
  liceName: null,
  referees: [],
  scheduledAt: null,
  liceId: null,
  source_a_type: null,
  source_b_type: null,
  registration_a_id: null,
  registration_b_id: null,
  ...over,
});

const ALPHA = team('tm1', 'Alpha', 'green');
const BRAVO = team('tm2', 'Bravo', 'purple');

/** One bout to come, Alpha against Bravo, with no Pool phase before it. */
export const BRACKET = {
  phaseId: 'ph1',
  phaseType: 'single_elim',
  bracketSize: 2,
  fighterCount: 2,
  byeCount: 0,
  rounds: 1,
  totalSlots: 1,
  hasPoolPhase: false,
  poolsCompleted: true,
  slots: [slot('s1', ALPHA, BRAVO)],
};

/** A final the green team won, and its bronze bout, for the podium. */
export const PLAYED = {
  ...BRACKET,
  bracketSize: 4,
  totalSlots: 2,
  bronzeSlotId: 's2',
  slots: [
    slot('s1', ALPHA, BRAVO, { status: 'completed', winnerSideId: 'tm1', redScore: 5 }),
    slot('s2', team('tm3', 'Charlie', 'red'), team('tm4', 'Delta', 'blue'), {
      status: 'completed',
      winnerSideId: 'tm4',
      matchId: 'm2',
    }),
  ],
};

export const RATING_SENTENCE =
  'A team is rated by its named members, so a team bracket cannot be seeded by rating yet.';

/** The API's answer to a team bracket seeded by rating. */
export const RATING_REFUSED = {
  ok: false,
  kind: 'http',
  status: 409,
  detail: RATING_SENTENCE,
  code: 'CONFLICT',
  details: { reason: 'rating_needs_named_members', message: RATING_SENTENCE },
  validationErrors: null,
};
