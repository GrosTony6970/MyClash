import { describe, expect, it } from 'vitest';
import { resolveMatchWinner } from './resolve-match-winner';

const base = {
  redRegistrationId: 'red-reg',
  blueRegistrationId: 'blue-reg',
  redScore: 5,
  blueScore: 3,
};

describe('resolveMatchWinner', () => {
  it('returns null until the match is completed', () => {
    expect(
      resolveMatchWinner({ ...base, status: 'running', winnerRegistrationId: 'red-reg' }),
    ).toBeNull();
  });

  it('uses the stored winner registration id', () => {
    expect(
      resolveMatchWinner({ ...base, status: 'completed', winnerRegistrationId: 'red-reg' }),
    ).toBe('red');
    expect(
      resolveMatchWinner({ ...base, status: 'completed', winnerRegistrationId: 'blue-reg' }),
    ).toBe('blue');
  });

  it('trusts the stored winner even when it contradicts the score (reverse rulesets)', () => {
    // Blue has the higher score but Red is the stored winner (reverse ruleset).
    expect(
      resolveMatchWinner({
        ...base,
        redScore: 0,
        blueScore: 7,
        status: 'completed',
        winnerRegistrationId: 'red-reg',
      }),
    ).toBe('red');
  });

  it('falls back to the higher score when no winner is stored (time-limit finish)', () => {
    expect(resolveMatchWinner({ ...base, status: 'completed', winnerRegistrationId: null })).toBe(
      'red',
    );
    expect(
      resolveMatchWinner({
        ...base,
        redScore: 2,
        blueScore: 4,
        status: 'completed',
        winnerRegistrationId: null,
      }),
    ).toBe('blue');
  });

  it('returns null on a tie / double-loss with no stored winner', () => {
    expect(
      resolveMatchWinner({
        ...base,
        redScore: 3,
        blueScore: 3,
        status: 'completed',
        winnerRegistrationId: null,
      }),
    ).toBeNull();
  });
});
