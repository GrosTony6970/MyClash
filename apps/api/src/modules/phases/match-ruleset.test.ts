import { describe, it, expect, vi } from 'vitest';
import { matchRulesetForPhase, matchRulesetForTournament } from './match-ruleset';

// Generated matches used to hardcode TF_v1/1.0.0 — the scoring engine reads
// the MATCH row, so non-TF tournaments were scored with the wrong engine.
// These helpers stamp the tournament's real ruleset (version normalized).

function supabaseReturning(row: unknown, error: { message: string } | null = null) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: error ? null : row, error }),
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
      ruleset_content_hash: null,
    });
  });

  // A bout is stamped with its Tournament's pair, which was checked when it was
  // set: no Tournament is no pair, and a bout stamped TF_v1 anyway would be
  // scored by an engine nobody chose.
  it('throws when the tournament row is missing, rather than stamping TF_v1', async () => {
    const supabase = supabaseReturning(null);
    await expect(matchRulesetForTournament(supabase, 't1')).rejects.toThrow(
      'has no ruleset pair to stamp',
    );
  });

  // A read that failed is not a Tournament with no ruleset: generated bouts were stamped
  // TF_v1 with no hash, and a club formula Tournament was then scored with TF_v1.
  it('throws when the read failed, rather than stamping TF_v1', async () => {
    const supabase = supabaseReturning(null, { message: 'connection reset' });
    await expect(matchRulesetForTournament(supabase, 't1')).rejects.toThrow(
      /^The ruleset of Tournament t1 was not read: connection reset$/,
    );
  });

  it("carries the tournament's content hash when stamped", async () => {
    const supabase = supabaseReturning({
      ruleset_code: 'TF_v1',
      ruleset_version: '1.0.0',
      ruleset_content_hash: 'abc123',
    });
    await expect(matchRulesetForTournament(supabase, 't1')).resolves.toEqual({
      ruleset_code: 'TF_v1',
      ruleset_version: '1.0.0',
      ruleset_content_hash: 'abc123',
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
      ruleset_content_hash: null,
    });
  });

  it('throws when the read failed, rather than stamping TF_v1', async () => {
    const supabase = supabaseReturning(null, { message: 'connection reset' });
    await expect(matchRulesetForPhase(supabase, 'phase-1')).rejects.toThrow(
      /^The ruleset of phase phase-1 was not read: connection reset$/,
    );
  });

  it('normalizes an array-shaped embed defensively', async () => {
    const supabase = supabaseReturning({
      tournaments: [{ ruleset_code: 'TF_v1', ruleset_version: '1.0' }],
    });
    await expect(matchRulesetForPhase(supabase, 'phase-1')).resolves.toEqual({
      ruleset_code: 'TF_v1',
      ruleset_version: '1.0.0',
      ruleset_content_hash: null,
    });
  });
});
