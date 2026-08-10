import { describe, expect, it } from 'vitest';
import { resolveMatchWinner } from './match-winner';

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

  it('crowns the fighter BEHIND on points when the record says so', () => {
    // The whole reason this function exists. A referee_decision override, a
    // walkover, or a keep-current injury forfeit all award the bout to someone
    // who is losing on points — the eight surfaces that compared the two
    // numbers each announced the wrong name.
    expect(
      resolveMatchWinner({
        ...base,
        redScore: 1,
        blueScore: 5,
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

  it('returns null when the stored winner matches neither side', () => {
    // A mismatched pairing. Falling through to the score would invent a winner
    // the record does not name.
    expect(
      resolveMatchWinner({ ...base, status: 'completed', winnerRegistrationId: 'someone-else' }),
    ).toBeNull();
  });

  it('tolerates the null-ish shapes the DTOs actually carry', () => {
    // red_score/blue_score are nullable on `matches`, and several projections
    // hand through `null` registration ids for an unresolved bracket slot.
    expect(
      resolveMatchWinner({
        status: 'completed',
        winnerRegistrationId: undefined,
        redRegistrationId: null,
        blueRegistrationId: null,
        redScore: null,
        blueScore: null,
      }),
    ).toBeNull();
  });
});
