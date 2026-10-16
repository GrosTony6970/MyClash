import { describe, expect, it, vi } from 'vitest';
import { RulesetResolver } from './ruleset-resolver.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';

const FORMULA = { type: 'var', name: 'victories' };
const CONSTANTS = { pointsPerVictory: 3, pointsPerTie: 1, pointsPerLoss: 0, doublePenalty: 0 };

/**
 * A read that FAILED is not "no such ruleset". Read as none, a club formula bout was scored
 * with TF_v1 for the five seconds the answer stayed cached: a bout that reached TF_v1's cap
 * in that window was completed with a winner its own rules did not give.
 */
describe('RulesetResolver — a failed read', () => {
  /** Each query answers `answers[n]` in turn: an error, or the row it holds. */
  function resolverAnswering(answers: Array<{ data?: unknown; error?: { message: string } }>) {
    let call = 0;
    const from = vi.fn().mockImplementation(() => {
      const answer = answers[Math.min(call, answers.length - 1)]!;
      call += 1;
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: answer.data ?? null, error: answer.error ?? null }),
      };
      return chain;
    });
    return new RulesetResolver({ service: { from } } as never, createRulesetRegistry());
  }
  const FAILED = { error: { message: 'connection reset' } };
  const PUBLISHED = {
    data: {
      code: 'club_formula',
      version: '1.0.0',
      name: 'Club formula',
      status: 'published',
      is_system: false,
      base_code: null,
      base_version: null,
      score_formula: FORMULA,
      constants: CONSTANTS,
      tiebreakers: [],
      double_penalty_formula: null,
    },
  };

  it('throws when the parent row read failed, and keeps nothing cached', async () => {
    // No parent for the snapshot path, then the parent-row read fails, then it answers.
    const resolver = resolverAnswering([{}, FAILED, {}, PUBLISHED]);

    await expect(resolver.resolve('club_formula', '1.0.0')).rejects.toThrow(/connection reset/);
    expect((await resolver.resolve('club_formula', '1.0.0'))?.code).toBe('club_formula');
  });

  it('throws when the snapshot read failed, rather than reading the latest version instead', async () => {
    const resolver = resolverAnswering([FAILED]);

    await expect(resolver.resolve('club_formula', '1.0.0')).rejects.toThrow(/connection reset/);
  });
});
