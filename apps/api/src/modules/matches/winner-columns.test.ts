import { describe, expect, it } from 'vitest';
import { winnerColumns } from './winner-columns';

/**
 * The winner of a bout goes back into its own side's columns: a Registration wins into
 * `winner_registration_id`, a team into `winner_team_id` (0282), and the other column is cleared.
 */
const INDIVIDUAL = {
  red_registration_id: 'reg-r',
  red_team_id: null,
  blue_registration_id: 'reg-b',
  blue_team_id: null,
};
const TEAMS = {
  red_registration_id: null,
  red_team_id: 'team-r',
  blue_registration_id: null,
  blue_team_id: 'team-b',
};
const NO_SIDES = {
  red_registration_id: null,
  red_team_id: null,
  blue_registration_id: null,
  blue_team_id: null,
};

describe('winnerColumns', () => {
  it('writes an individual red winner into the Registration column', () => {
    expect(winnerColumns(INDIVIDUAL, 'reg-r')).toEqual({
      winner_registration_id: 'reg-r',
      winner_team_id: null,
    });
  });

  it('writes a team blue winner into the team column', () => {
    expect(winnerColumns(TEAMS, 'team-b')).toEqual({
      winner_registration_id: null,
      winner_team_id: 'team-b',
    });
  });

  it('writes no winner as both columns cleared', () => {
    expect(winnerColumns(TEAMS, null)).toEqual({
      winner_registration_id: null,
      winner_team_id: null,
    });
    expect(winnerColumns(NO_SIDES, null)).toEqual({
      winner_registration_id: null,
      winner_team_id: null,
    });
  });

  it('refuses a winner that is neither side', () => {
    expect(() => winnerColumns(TEAMS, 'reg-r')).toThrow(/neither side/);
  });

  it('refuses a winner on a bout with no side', () => {
    expect(() => winnerColumns(NO_SIDES, 'team-r')).toThrow(/neither side/);
  });
});
