/**
 * What the bracket page reads, for a test of it on an archived Event
 * (`page.archived.test.tsx`): one Tournament, drawn or not, with the Lices, the
 * registrations and the referee board its override panel offers.
 */

const slot = (id: string, position: number, over: Record<string, unknown> = {}) => ({
  id,
  round: 1,
  position,
  redFighterName: 'Ada',
  blueFighterName: 'Grace',
  redRegistrationId: 'r1',
  blueRegistrationId: 'r2',
  redScore: null,
  blueScore: null,
  status: 'scheduled',
  matchId: `m${position}`,
  liceId: 'L1',
  ...over,
});

/** A double-elimination bracket nobody has fought in: every control of the page is drawn. */
export const UNFOUGHT_BRACKET = {
  phaseId: 'ph1',
  phaseType: 'double_elim',
  bracketSize: 4,
  fighterCount: 4,
  byeCount: 0,
  rounds: 2,
  grandFinalReset: false,
  secondChanceTarget: 'gold',
  bronzeMatch: true,
  repechageEntrySize: null,
  totalSlots: 3,
  hasPoolPhase: true,
  poolsCompleted: true,
  slots: [
    slot('s1', 1),
    slot('s2', 2, {
      redFighterName: 'Cy',
      blueFighterName: 'Dee',
      redRegistrationId: 'r3',
      blueRegistrationId: 'r4',
    }),
    // The final: nobody is placed in it yet, and it has no bout.
    slot('s3', 1, {
      round: 2,
      redFighterName: null,
      blueFighterName: null,
      redRegistrationId: null,
      blueRegistrationId: null,
      matchId: null,
      liceId: null,
    }),
  ],
};

const registration = (id: string, givenName: string) => ({
  id,
  bib_number: null,
  seed: null,
  persons: { given_name: givenName, family_name: null },
  global_persons: null,
});

/** The referee board, as far as the override panel reads it: one role on bout `m1`. */
const BOARD = {
  pools: [
    {
      matchIds: ['m1'],
      roleSlots: [
        {
          role: 'arbitre_declarant',
          displayName: null,
          allowedSkillIds: [],
          assignment: null,
          candidates: {
            recommended: [{ personId: 'p9', displayName: 'Rae' }],
            warning: [],
            blocked: [],
          },
        },
      ],
    },
  ],
};

/** Every read of the page. `brackets` holds each Tournament's bracket, `null` for none. */
export function bracketReads(brackets: Record<string, unknown>): Record<string, unknown> {
  const reads: Record<string, unknown> = {
    '/api/v1/events/ev1/tournaments': Object.keys(brackets).map((id) => ({ id, name: id })),
    '/api/v1/events/ev1/lices': [
      { id: 'L1', name: 'Piste 1' },
      { id: 'L2', name: 'Piste 2' },
    ],
    '/api/v1/events/ev1/referee-skills': [],
    '/api/v1/events/ev1/referee-assignment-board': BOARD,
  };
  for (const [id, bracket] of Object.entries(brackets)) {
    reads[`/api/v1/tournaments/${id}`] = { weapon: 'longsword' };
    reads[`/api/v1/tournaments/${id}/bracket`] = bracket;
    reads[`/api/v1/tournaments/${id}/registrations`] = [
      registration('r1', 'Ada'),
      registration('r2', 'Grace'),
      registration('r3', 'Cy'),
      registration('r4', 'Dee'),
    ];
  }
  return reads;
}
