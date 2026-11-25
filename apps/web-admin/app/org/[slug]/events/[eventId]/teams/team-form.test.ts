import { describe, expect, it } from 'vitest';
import { createBody, formOf, teamTournamentOf, updateBody } from './team-form';

/** The team dialog's bodies, as `CreateTeamDto` and `UpdateTeamDto` take them. */
describe('the team bodies', () => {
  it('a save with the size cleared keeps the stored size: a team always has one', () => {
    expect(updateBody({ name: 'Lyon', size: '', color: 'red', seed: '3' })).toEqual({
      name: 'Lyon',
      color: 'red',
      seed: 3,
    });
  });

  it('a new team starts with no size when its Tournament has no default', () => {
    expect(formOf(null, null)).toEqual({ name: '', size: '', color: '', seed: '' });
    expect(createBody(formOf(null, null))).toEqual({ name: '' });
  });

  it('reads a team Tournament from the Event list, and passes over an individual one', () => {
    expect(teamTournamentOf({ id: 't-1', name: 'Longsword', entrant_kind: 'individual' })).toBe(
      null,
    );
    expect(
      teamTournamentOf({ id: 'tt-1', name: 'Team', entrant_kind: 'team', team_default_size: 3 }),
    ).toEqual({ id: 'tt-1', name: 'Team', color: null, teamDefaultSize: 3 });
  });
});
