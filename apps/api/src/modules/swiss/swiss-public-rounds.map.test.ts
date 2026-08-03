import { describe, expect, it } from 'vitest';
import {
  buildFighterIndex,
  toPublicRounds,
  type EntrantNameRow,
  type PublicMatchRow,
  type PublicRoundRow,
} from './swiss-public-rounds.map';

const entrant = (id: string, given: string, family: string, club?: string): EntrantNameRow => ({
  registration_id: id,
  registrations: {
    persons: {
      given_name: given,
      family_name: family,
      clubs: club ? { name: club, abbreviation: club.slice(0, 3).toUpperCase() } : null,
    },
  },
});

const round = (id: string, number: number, over?: Partial<PublicRoundRow>): PublicRoundRow => ({
  id,
  round_number: number,
  status: 'pending',
  bye_registration_id: null,
  pairing_meta_json: null,
  ...over,
});

const match = (id: string, roundId: string, over?: Partial<PublicMatchRow>): PublicMatchRow => ({
  id,
  swiss_round_id: roundId,
  match_number_label: 'SW-R1-M1',
  status: 'scheduled',
  scheduled_at: null,
  red_registration_id: null,
  blue_registration_id: null,
  red_score: null,
  blue_score: null,
  winner_registration_id: null,
  lices: null,
  ...over,
});

describe('buildFighterIndex', () => {
  it('joins the name and prefers the club abbreviation', () => {
    const index = buildFighterIndex([entrant('r1', 'Ada', 'Lovelace', 'Analytical')]);
    expect(index.get('r1')).toEqual({
      registrationId: 'r1',
      fighterName: 'Ada Lovelace',
      clubAbbrev: 'ANA',
    });
  });

  it('survives a missing person embed rather than rendering "undefined undefined"', () => {
    const index = buildFighterIndex([{ registration_id: 'r1', registrations: null }]);
    expect(index.get('r1')).toEqual({
      registrationId: 'r1',
      fighterName: '',
      clubAbbrev: null,
    });
  });
});

describe('toPublicRounds', () => {
  const fighters = buildFighterIndex([
    entrant('r1', 'Ada', 'Lovelace', 'Analytical'),
    entrant('r2', 'Alan', 'Turing'),
    entrant('r3', 'Grace', 'Hopper'),
  ]);

  it('resolves both sides to names and carries the piste', () => {
    const [output] = toPublicRounds(
      [round('rd1', 1)],
      [
        match('m1', 'rd1', {
          red_registration_id: 'r1',
          blue_registration_id: 'r2',
          red_score: 5,
          blue_score: 3,
          winner_registration_id: 'r1',
          lices: { name: 'Piste 2', color_hex: '#abc' },
        }),
      ],
      fighters,
    );
    const bout = output!.matches[0]!;
    expect(bout.redFighterName).toBe('Ada Lovelace');
    expect(bout.blueFighterName).toBe('Alan Turing');
    expect(bout.redClubAbbrev).toBe('ANA');
    expect(bout.blueClubAbbrev).toBeNull();
    expect(bout.winnerRegistrationId).toBe('r1');
    expect(bout.liceName).toBe('Piste 2');
    expect(bout.liceColorHex).toBe('#abc');
  });

  it('names the bye holder', () => {
    const [output] = toPublicRounds([round('rd1', 1, { bye_registration_id: 'r3' })], [], fighters);
    expect(output!.byeFighterName).toBe('Grace Hopper');
  });

  it('orders bouts by board NUMBER, not by label string', () => {
    const [output] = toPublicRounds(
      [round('rd1', 1)],
      [
        match('m10', 'rd1', { match_number_label: 'SW-R1-M10' }),
        match('m2', 'rd1', { match_number_label: 'SW-R1-M2' }),
      ],
      fighters,
    );
    expect(output!.matches.map((m) => m.id)).toEqual(['m2', 'm10']);
  });

  it('badges a manually adjusted round and surfaces the engine warnings', () => {
    const warnings = [{ code: 'forced-rematch', registrationIds: ['r1', 'r2'] }];
    const [output] = toPublicRounds(
      [round('rd1', 1, { pairing_meta_json: { warnings, manualAdjustments: [{ at: 'now' }] } })],
      [],
      fighters,
    );
    expect(output!.manuallyAdjusted).toBe(true);
    expect(output!.warnings).toEqual(warnings);
  });

  it('reports an untouched round as not adjusted and with no warnings', () => {
    const [output] = toPublicRounds([round('rd1', 1)], [], fighters);
    expect(output!.manuallyAdjusted).toBe(false);
    expect(output!.warnings).toEqual([]);
  });

  it('ignores a match whose round was deleted out from under it', () => {
    const [output] = toPublicRounds(
      [round('rd1', 1)],
      [match('orphan', 'rd1'), { ...match('loose', 'rd1'), swiss_round_id: null }],
      fighters,
    );
    expect(output!.matches.map((m) => m.id)).toEqual(['orphan']);
  });
});
