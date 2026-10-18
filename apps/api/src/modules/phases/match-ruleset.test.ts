import { describe, it, expect } from 'vitest';
import { lastFunctionParams } from '../../common/testing/migration-function';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  type ChainResult,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { rulesOf, withStampedRules } from './match-rules.fixtures';
import {
  matchRulesetForBout,
  matchRulesetForPhase,
  matchRulesetForTournament,
} from './match-ruleset';

// Generated matches used to hardcode TF_v1/1.0.0 — the scoring engine reads
// the MATCH row, so non-TF tournaments were scored with the wrong engine.
// These helpers stamp the tournament's copy of its rules (its row builder writes "1" as 1.0.0).

const COPY_SELECT = 'ruleset_code, ruleset_version, ruleset_content_hash';

/** Two Tournaments: the stamp and the copy read must be of the one named. */
const seed = (t1: Record<string, unknown>): Record<string, TableSeed> => ({
  tournaments: {
    rows: [
      { id: 't-other', ruleset_code: 'TF_v1' },
      { id: 't1', ...t1 },
    ],
  },
  phases: {
    rows: [
      { id: 'phase-other', tournament_id: 't-other' },
      { id: 'phase-1', tournament_id: 't1' },
    ],
  },
});

const stamped = (t1: Record<string, unknown>) => mockSupabase(...withStampedRules(seed(t1)));

/** A stamp that answers `result`, whatever Tournament it is asked for. */
const stampAnswering = (result: ChainResult, tables: Record<string, TableSeed> = seed({})) =>
  mockSupabase(tables, { stamp_match_rules: () => result });

describe('matchRulesetForTournament', () => {
  it('returns the copy the stamp made, its version as the copy holds it', async () => {
    const supabase = stamped({ ruleset_code: 'Generic_PointsCap', ruleset_version: '1' });

    await expect(matchRulesetForTournament(supabase.service as never, 't1')).resolves.toEqual({
      match_rules_id: rulesOf('t1'),
      ruleset_code: 'Generic_PointsCap',
      ruleset_version: '1.0.0',
      ruleset_content_hash: null,
    });
    expect(supabase.rpc.mock.calls).toEqual([['stamp_match_rules', { p_tournament_id: 't1' }]]);
    expect(selectsFor(supabase.from, 'match_rules')).toEqual([COPY_SELECT]);
    expect(filtersFor(supabase.from, 'match_rules', 'eq')).toEqual([['id', rulesOf('t1')]]);
  });

  // The double cannot see a renamed key: the call would reach a function that does not exist.
  it('calls the stamp with the argument names the migration defines', async () => {
    const supabase = stamped({ ruleset_code: 'TF_v1' });

    await matchRulesetForTournament(supabase.service as never, 't1');

    expect(Object.keys(supabase.rpc.mock.calls[0]![1] ?? {})).toEqual(
      lastFunctionParams('stamp_match_rules'),
    );
  });

  it("carries the copy's content hash", async () => {
    const supabase = stamped({
      ruleset_code: 'TF_v1',
      ruleset_version: '1.0.0',
      ruleset_content_hash: 'abc123',
    });

    await expect(matchRulesetForTournament(supabase.service as never, 't1')).resolves.toEqual({
      match_rules_id: rulesOf('t1'),
      ruleset_code: 'TF_v1',
      ruleset_version: '1.0.0',
      ruleset_content_hash: 'abc123',
    });
  });

  // A bout is stamped with its Tournament's pair, which was checked when it was
  // set: a copy with no pair is a fault, and a bout stamped TF_v1 anyway would be
  // scored by an engine nobody chose.
  it('throws when the copy row is missing, rather than stamping TF_v1', async () => {
    const supabase = stampAnswering(
      { data: 'rules-nowhere', error: null },
      {
        match_rules: { rows: [] },
      },
    );

    await expect(matchRulesetForTournament(supabase.service as never, 't1')).rejects.toThrow(
      'The Tournament has no ruleset pair to stamp on its bouts',
    );
  });

  it('throws when the copy holds no ruleset code, rather than stamping TF_v1', async () => {
    const supabase = stampAnswering(
      { data: 'rules-t1', error: null },
      {
        match_rules: { rows: [{ id: 'rules-t1', ruleset_code: '', ruleset_version: '1' }] },
      },
    );

    await expect(matchRulesetForTournament(supabase.service as never, 't1')).rejects.toThrow(
      'The Tournament has no ruleset pair to stamp on its bouts',
    );
  });

  // A call that failed is not a Tournament with no ruleset: generated bouts were stamped
  // TF_v1 with no hash, and a club formula Tournament was then scored with TF_v1.
  it('throws when the stamp failed, rather than stamping TF_v1', async () => {
    const supabase = stampAnswering({ data: null, error: { message: 'connection reset' } });

    await expect(matchRulesetForTournament(supabase.service as never, 't1')).rejects.toThrow(
      /^The ruleset of Tournament t1 was not read: connection reset$/,
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('throws when the stamp answered no copy', async () => {
    const supabase = stampAnswering({ data: null, error: null });

    await expect(matchRulesetForTournament(supabase.service as never, 't1')).rejects.toThrow(
      /^The ruleset of Tournament t1 was not read: no copy$/,
    );
  });

  // Gone is quiet only for a re-stamp: a bout cannot be generated in no Tournament.
  it('throws for a Tournament that is gone', async () => {
    const supabase = stamped({ ruleset_code: 'TF_v1' });

    await expect(matchRulesetForTournament(supabase.service as never, 't-gone')).rejects.toThrow(
      'The ruleset of Tournament t-gone was not read: Tournament t-gone was not found',
    );
  });

  it('throws when the copy could not be read', async () => {
    const supabase = stampAnswering(
      { data: 'rules-t1', error: null },
      {
        match_rules: { data: null, error: { message: 'connection reset' } },
      },
    );

    await expect(matchRulesetForTournament(supabase.service as never, 't1')).rejects.toThrow(
      /^The copy of Tournament t1's rules was not read: connection reset$/,
    );
  });
});

describe('matchRulesetForPhase', () => {
  it("reads the phase's Tournament, then stamps that Tournament", async () => {
    const supabase = stamped({ ruleset_code: 'FormulaRuleset_org', ruleset_version: '2.0.0' });

    await expect(matchRulesetForPhase(supabase.service as never, 'phase-1')).resolves.toEqual({
      match_rules_id: rulesOf('t1'),
      ruleset_code: 'FormulaRuleset_org',
      ruleset_version: '2.0.0',
      ruleset_content_hash: null,
    });
    expect(selectsFor(supabase.from, 'phases')).toEqual(['tournament_id']);
    expect(filtersFor(supabase.from, 'phases', 'eq')).toEqual([['id', 'phase-1']]);
    expect(supabase.rpc.mock.calls).toEqual([['stamp_match_rules', { p_tournament_id: 't1' }]]);
    expect(selectsFor(supabase.from, 'match_rules')).toEqual([COPY_SELECT]);
  });

  it('throws when the read failed, rather than stamping TF_v1', async () => {
    const supabase = stampAnswering(
      { data: 'rules-t1', error: null },
      {
        phases: { data: null, error: { message: 'connection reset' } },
      },
    );

    await expect(matchRulesetForPhase(supabase.service as never, 'phase-1')).rejects.toThrow(
      /^The ruleset of phase phase-1 was not read: connection reset$/,
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('throws for a phase that is not found, and stamps nothing', async () => {
    const supabase = stamped({ ruleset_code: 'TF_v1' });

    await expect(matchRulesetForPhase(supabase.service as never, 'phase-gone')).rejects.toThrow(
      'The ruleset of phase phase-gone was not read: no Tournament',
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe('matchRulesetForBout', () => {
  /** A bout of phase-1, with its phase embedded as PostgREST may answer it. */
  const boutSeed = (phases: unknown) => ({
    ...seed({ ruleset_code: 'TF_v1', ruleset_version: '1.0' }),
    matches: {
      rows: [
        { id: 'm-other', phases: { tournament_id: 't-other' } },
        { id: 'm1', phases },
      ],
    },
  });

  it("reads the bout's Tournament through its phase, then stamps it", async () => {
    const supabase = mockSupabase(...withStampedRules(boutSeed({ tournament_id: 't1' })));

    await expect(matchRulesetForBout(supabase.service as never, 'm1')).resolves.toEqual({
      match_rules_id: rulesOf('t1'),
      ruleset_code: 'TF_v1',
      ruleset_version: '1.0.0',
      ruleset_content_hash: null,
    });
    expect(selectsFor(supabase.from, 'matches')).toEqual(['phases(tournament_id)']);
    expect(filtersFor(supabase.from, 'matches', 'eq')).toEqual([['id', 'm1']]);
    expect(supabase.rpc.mock.calls).toEqual([['stamp_match_rules', { p_tournament_id: 't1' }]]);
  });

  it('normalizes an array-shaped embed defensively', async () => {
    const supabase = mockSupabase(...withStampedRules(boutSeed([{ tournament_id: 't1' }])));

    await expect(matchRulesetForBout(supabase.service as never, 'm1')).resolves.toMatchObject({
      match_rules_id: rulesOf('t1'),
    });
  });

  it('throws for a bout with no Tournament, and stamps nothing', async () => {
    const supabase = mockSupabase(...withStampedRules(boutSeed(null)));

    await expect(matchRulesetForBout(supabase.service as never, 'm1')).rejects.toThrow(
      /^The ruleset of bout m1 was not read: no Tournament$/,
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('throws when the read failed', async () => {
    const supabase = stampAnswering(
      { data: 'rules-t1', error: null },
      {
        matches: { data: null, error: { message: 'connection reset' } },
      },
    );

    await expect(matchRulesetForBout(supabase.service as never, 'm1')).rejects.toThrow(
      /^The ruleset of bout m1 was not read: connection reset$/,
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
