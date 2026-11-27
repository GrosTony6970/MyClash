import { describe, expect, it } from 'vitest';
import { resolveMatchWinner } from './match-winner';

const base = {
  redRegistrationId: 'red-reg',
  blueRegistrationId: 'blue-reg',
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

  it('names nobody when no winner is stored: a draw, or a loss for both', () => {
    // The score is not an input any more. A finished bout with no winner is a
    // draw (or a doubles-limit loss for both); the fallback to the higher score
    // named the leader of a bout the doubles limit had called a draw (ruling 1009).
    expect(
      resolveMatchWinner({ ...base, status: 'completed', winnerRegistrationId: null }),
    ).toBeNull();
  });

  it('returns null when the stored winner matches neither side', () => {
    // A mismatched pairing: the record names nobody in this bout.
    expect(
      resolveMatchWinner({ ...base, status: 'completed', winnerRegistrationId: 'someone-else' }),
    ).toBeNull();
  });

  it('tolerates the null-ish shapes the DTOs actually carry', () => {
    // Several projections hand through `null` registration ids for an unresolved bracket slot.
    expect(
      resolveMatchWinner({
        status: 'completed',
        winnerRegistrationId: undefined,
        redRegistrationId: null,
        blueRegistrationId: null,
      }),
    ).toBeNull();
  });
});
