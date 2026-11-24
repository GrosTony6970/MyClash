import { describe, expect, it } from 'vitest';
import { sideMissing } from './bout-sides';

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
    expect(
      sideMissing({
        redRegistrationId: null,
        blueRegistrationId: null,
        redTeamId: 'team-red',
        blueTeamId: 'team-blue',
      }),
    ).toBe(false);
  });

  // A copy the tablet kept before the bout read carried the team ids.
  it('a kept copy without team ids is judged on its Registrations', () => {
    expect(sideMissing({ redRegistrationId: 'reg-anna', blueRegistrationId: 'reg-ben' })).toBe(
      false,
    );
    expect(sideMissing({ redRegistrationId: 'reg-anna', blueRegistrationId: null })).toBe(true);
  });
});
