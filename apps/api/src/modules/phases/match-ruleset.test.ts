import { describe, it, expect, vi } from 'vitest';
import { matchRulesetForPhase, matchRulesetForTournament } from './match-ruleset';

// Generated matches used to hardcode TF_v1/1.0.0 — the scoring engine reads
// the MATCH row, so non-TF tournaments were scored with the wrong engine.
// These helpers stamp the tournament's real ruleset (version normalized).

function supabaseReturning(row: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return { from: vi.fn().mockReturnValue(chain) } as never;
}

describe('matchRulesetForTournament', () => {
  it('returns the tournament ruleset with the version normalized ("1" → "1.0.0")', async () => {
    const supabase = supabaseReturning({ ruleset_code: 'Generic_PointsCap', ruleset_version: '1' });
    await expect(matchRulesetForTournament(supabase, 't1')).resolves.toEqual({
      ruleset_code: 'Generic_PointsCap',
      ruleset_version: '1.0.0',
    });
  });

  it('falls back to TF_v1/1.0.0 when the tournament row is missing', async () => {
    const supabase = supabaseReturning(null);
    await expect(matchRulesetForTournament(supabase, 't1')).resolves.toEqual({
      ruleset_code: 'TF_v1',
      ruleset_version: '1.0.0',
    });
  });
});

describe('matchRulesetForPhase', () => {
  it('resolves through the phase → tournaments embed (object shape)', async () => {
    const supabase = supabaseReturning({
      tournaments: { ruleset_code: 'FormulaRuleset_org', ruleset_version: '2.0.0' },
    });
    await expect(matchRulesetForPhase(supabase, 'phase-1')).resolves.toEqual({
      ruleset_code: 'FormulaRuleset_org',
      ruleset_version: '2.0.0',
    });
  });

  it('normalizes an array-shaped embed defensively', async () => {
    const supabase = supabaseReturning({
      tournaments: [{ ruleset_code: 'TF_v1', ruleset_version: '1.0' }],
    });
    await expect(matchRulesetForPhase(supabase, 'phase-1')).resolves.toEqual({
      ruleset_code: 'TF_v1',
      ruleset_version: '1.0.0',
    });
  });
});
