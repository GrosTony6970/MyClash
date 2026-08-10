import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORFEIT_POLICY,
  FORFEIT_REASONS,
  ForfeitReasonSchema,
  isOverrideReason,
  OVERRIDE_REASONS,
  resolveForfeitPolicy,
  type ForfeitReason,
} from './forfeits';

describe('forfeit policies', () => {
  it.each([
    ['injury', 'keep_current', 'ask'],
    ['voluntary', 'fixed_loss', 'ask'],
    ['black_card_1', 'fixed_loss', 'ask'],
    ['black_card_2', 'fixed_loss', 'disqualified'],
    ['conduct_violation', 'fixed_loss', 'disqualified'],
  ] as Array<[ForfeitReason, string, string]>)(
    'maps %s to the FFAMHE default policy',
    (reason, scorePolicy, tournamentState) => {
      const policy = resolveForfeitPolicy(DEFAULT_FORFEIT_POLICY, reason);

      expect(policy.scorePolicy).toBe(scorePolicy);
      expect(policy.tournamentState).toBe(tournamentState);
    },
  );

  it('allows tournament config to override a reason policy', () => {
    const policy = resolveForfeitPolicy(
      {
        ...DEFAULT_FORFEIT_POLICY,
        reasons: {
          ...DEFAULT_FORFEIT_POLICY.reasons,
          voluntary: {
            ...DEFAULT_FORFEIT_POLICY.reasons.voluntary,
            lossScore: 5,
            tournamentState: 'match_only',
          },
        },
      },
      'voluntary',
    );

    expect(policy.lossScore).toBe(5);
    expect(policy.tournamentState).toBe('match_only');
  });
});

describe('forfeit vs override classification', () => {
  // The guard that keeps a future reason from landing unclassified: every read
  // that counts forfeits filters by FORFEIT_REASONS, so a reason in neither
  // list would be silently invisible to the standings and the exports.
  it('partitions the reason enum exhaustively', () => {
    const classified = [...FORFEIT_REASONS, ...OVERRIDE_REASONS];

    expect([...classified].sort()).toEqual([...ForfeitReasonSchema.options].sort());
    expect(new Set(classified).size).toBe(classified.length);
  });

  it.each(FORFEIT_REASONS)('treats %s as a forfeit', (reason) => {
    expect(isOverrideReason(reason)).toBe(false);
  });

  it.each(OVERRIDE_REASONS)('treats %s as an override', (reason) => {
    expect(isOverrideReason(reason)).toBe(true);
  });

  it('reads an unknown reason as a forfeit, not an override', () => {
    // Direction matters: an unrecognised value must not gain the override's
    // exemption from the DQ counters and the HEMA Ratings exclusion.
    expect(isOverrideReason('something_else')).toBe(false);
  });

  it.each(OVERRIDE_REASONS)('gives %s an explicit, state-neutral policy', (reason) => {
    const policy = resolveForfeitPolicy(DEFAULT_FORFEIT_POLICY, reason);

    expect(policy.scorePolicy).toBe('explicit');
    expect(policy.tournamentState).toBe('match_only');
  });
});
