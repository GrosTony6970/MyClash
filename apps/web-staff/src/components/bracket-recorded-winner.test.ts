/**
 * The piste screen's bracket bolds the recorded winner of a bout, not the higher score.
 *
 * Anna (red) leads the final 5 to 2. She forfeits with an injury and the score stands, so the
 * record names Bea (blue) the winner. The piste's bracket card must bold Bea's score. The bracket
 * answer once reached the card through a cast to the card's own slot type, which would have
 * compiled whatever the answer named its winner; the card now takes the answer as the bracket
 * read declares it (`TournamentBracketPayload`).
 *
 * web-staff has no React test setup: the bracket is drawn once on the server renderer.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BracketView, accentClassFor, accentInkClassFor } from '@myclash/ui';
import type { BracketSideWire } from '@myclash/types/bracket-side';
import { describe, expect, it } from 'vitest';
import type { TournamentBracketPayload } from './tournament-context-types';

const fighter = (registrationId: string, name: string): BracketSideWire => ({
  sideId: registrationId,
  kind: 'individual',
  registrationId,
  teamId: null,
  name,
  clubAbbrev: null,
  colour: null,
});

/** The final, as the staff bracket route sends it. */
const FINAL: TournamentBracketPayload['slots'][number] = {
  id: 'slot-final',
  round: 1,
  position: 1,
  status: 'completed',
  matchId: 'm-final',
  redFighterName: 'Anna',
  blueFighterName: 'Bea',
  redClubAbbrev: null,
  blueClubAbbrev: null,
  redScore: 5,
  blueScore: 2,
  redRegistrationId: 'reg-anna',
  blueRegistrationId: 'reg-bea',
  winnerRegistrationId: 'reg-bea',
  redSideId: 'reg-anna',
  blueSideId: 'reg-bea',
  winnerSideId: 'reg-bea',
  red: fighter('reg-anna', 'Anna'),
  blue: fighter('reg-bea', 'Bea'),
  scheduledAt: null,
  liceId: 'lice-1',
  liceName: 'Piste 1',
  referees: [],
  source_a_type: null,
  source_a_ref: null,
  source_b_type: null,
  source_b_ref: null,
  registration_a_id: 'reg-anna',
  registration_b_id: 'reg-bea',
};

/** The winner's score chip of a side colour: the solid fill, its ink, bold. */
const winnerChip = (colour: 'red' | 'blue') =>
  `${accentClassFor(colour)} ${accentInkClassFor(colour)} font-bold`;

describe("the piste screen's bracket card", () => {
  it('bolds the recorded winner when a forfeit wins on the lower score', () => {
    const payload: TournamentBracketPayload = {
      rounds: 1,
      bracketSize: 2,
      phaseType: 'single_elim',
      slots: [FINAL],
    };
    const html = renderToStaticMarkup(
      createElement(BracketView, {
        slots: payload.slots,
        rounds: payload.rounds,
        redColor: 'red',
        blueColor: 'blue',
        highlightLiceId: 'lice-1',
        t: (key: string) => key,
      }),
    );

    expect(html).toContain(winnerChip('blue'));
    expect(html).not.toContain(winnerChip('red'));
  });
});
