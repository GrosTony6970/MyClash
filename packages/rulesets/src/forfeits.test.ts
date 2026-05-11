import { describe, expect, it } from 'vitest';
import { DEFAULT_FORFEIT_POLICY, resolveForfeitPolicy, type ForfeitReason } from './forfeits';

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
