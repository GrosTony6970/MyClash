import { describe, expect, it } from 'vitest';
import { sideIdOf, sideMissing, sideOf } from './bout-sides';

/**
 * Lyon Blades fight Paris Rapiers in a team Pool. The scorekeeper cards Lyon on red: the card
 * goes to the team, never to a Registration the team does not have.
 */
const TEAMS = {
  redRegistrationId: null,
  blueRegistrationId: null,
  redTeamId: 'team-lyon',
  blueTeamId: 'team-paris',
};

describe('sideOf', () => {
  it('a team bout gives each corner its team', () => {
    expect(sideOf(TEAMS, 'red')).toEqual({ kind: 'team', id: 'team-lyon' });
    expect(sideOf(TEAMS, 'blue')).toEqual({ kind: 'team', id: 'team-paris' });
  });

  it('a Fighters’ bout gives each corner its Registration', () => {
    const bout = { ...TEAMS, redTeamId: null, blueTeamId: null };
    expect(sideOf({ ...bout, redRegistrationId: 'reg-anna' }, 'red')).toEqual({
      kind: 'registration',
      id: 'reg-anna',
    });
    expect(sideOf({ ...bout, blueRegistrationId: 'reg-ben' }, 'blue')).toEqual({
      kind: 'registration',
      id: 'reg-ben',
    });
  });

  it('a corner still to come has no side', () => {
    expect(sideOf({ ...TEAMS, redTeamId: null }, 'red')).toBeNull();
    expect(sideOf({ ...TEAMS, blueTeamId: null }, 'blue')).toBeNull();
  });

  it('a kept copy without team ids reads its Registrations', () => {
    expect(sideOf({ redRegistrationId: 'reg-anna', blueRegistrationId: null }, 'red')).toEqual({
      kind: 'registration',
      id: 'reg-anna',
    });
    expect(sideOf({ redRegistrationId: 'reg-anna', blueRegistrationId: null }, 'blue')).toBeNull();
  });
});

describe('sideIdOf', () => {
  it("is the key of each corner's side: a team, a Registration, or null while to come", () => {
    expect(sideIdOf(TEAMS, 'red')).toBe('team-lyon');
    expect(sideIdOf(TEAMS, 'blue')).toBe('team-paris');
    expect(sideIdOf({ ...TEAMS, redTeamId: null, redRegistrationId: 'reg-anna' }, 'red')).toBe(
      'reg-anna',
    );
    expect(sideIdOf({ ...TEAMS, blueTeamId: null }, 'blue')).toBeNull();
  });
});

/**
 * Léa opens the final on her pad. The semi-final that feeds its blue side is still running, so
 * the final has Anna on red and nobody on blue. The pad must not let her start it, score it or
 * card it: there is nobody to score.
 */
const BOTH = {
  redRegistrationId: 'reg-anna',
  blueRegistrationId: 'reg-ben',
  redTeamId: null,
  blueTeamId: null,
};

describe('sideMissing', () => {
  it('a bout with both Fighters waits for nobody', () => {
    expect(sideMissing(BOTH)).toBe(false);
  });

  it('a bout with no red Fighter waits', () => {
    expect(sideMissing({ ...BOTH, redRegistrationId: null })).toBe(true);
  });

  it('a bout with no blue Fighter waits', () => {
    expect(sideMissing({ ...BOTH, blueRegistrationId: null })).toBe(true);
  });

  it('a bracket placeholder with no side at all waits', () => {
    expect(sideMissing({ ...BOTH, redRegistrationId: null, blueRegistrationId: null })).toBe(true);
  });

  // A team bout: its sides are teams, with no Registration. Both are known.
  it('a team side is a known side', () => {
    expect(sideMissing(TEAMS)).toBe(false);
  });

  // A copy the tablet kept before the bout read carried the team ids.
  it('a kept copy without team ids is judged on its Registrations', () => {
    expect(sideMissing({ redRegistrationId: 'reg-anna', blueRegistrationId: 'reg-ben' })).toBe(
      false,
    );
    expect(sideMissing({ redRegistrationId: 'reg-anna', blueRegistrationId: null })).toBe(true);
  });
});
