import { describe, expect, it } from 'vitest';
import { countPoolFighters, isTeamPool } from './count-pool-fighters';

const bout = (red: string | null, blue: string | null) => ({
  red_registration_id: red,
  blue_registration_id: blue,
  red_team_id: null,
  blue_team_id: null,
});
const teamBout = (red: string | null, blue: string | null) => ({
  red_registration_id: null,
  blue_registration_id: null,
  red_team_id: red,
  blue_team_id: blue,
});

describe('countPoolFighters', () => {
  it('returns the distinct fighter count for a 4-fighter Berger pool (6 matches)', () => {
    // 4-fighter round-robin: every fighter plays every other once = 6 matches.
    // Each fighter appears in 3 matches, half red / half blue depending on Berger.
    const matches = [
      bout('a', 'b'),
      bout('c', 'd'),
      bout('a', 'c'),
      bout('d', 'b'),
      bout('a', 'd'),
      bout('b', 'c'),
    ];
    expect(countPoolFighters(matches)).toBe(4);
  });

  it('skips null sides so bye / unseeded slots do not inflate the count', () => {
    const matches = [bout('a', 'b'), bout('a', null), bout(null, 'b')];
    expect(countPoolFighters(matches)).toBe(2);
  });

  it('returns 0 for an empty match list', () => {
    expect(countPoolFighters([])).toBe(0);
  });

  it('counts the teams of a team Pool, whose Registration sides are all null', () => {
    const matches = [
      teamBout('lyon', 'paris'),
      teamBout('lyon', 'metz'),
      teamBout('paris', 'metz'),
    ];
    expect(countPoolFighters(matches)).toBe(3);
  });
});

describe('isTeamPool', () => {
  it('is true for a Pool of teams and false for a Pool of Fighters', () => {
    expect(isTeamPool([teamBout('lyon', 'paris')])).toBe(true);
    expect(isTeamPool([bout('a', 'b')])).toBe(false);
  });
});
