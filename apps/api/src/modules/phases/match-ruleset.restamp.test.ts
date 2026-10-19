/**
 * The bouts of a Tournament that have not started take its ruleset (operator,
 * 2026-10-11).
 *
 * An organiser generates the Pools under TF_v1, then switches the Tournament to
 * the points-cap ruleset before the first bout. The Pool table was computed
 * with the new ruleset and every bout was scored with the old one, because a
 * bout was scored with the pair stamped on its own row and nothing stamped it
 * again.
 *
 * The database writes the bouts now (`stamp_match_rules`, migration 0229): which bouts move, and
 * that a bout that holds the copy already is not written again, is the RLS probe's to prove
 * (`scripts/lib/match-rules-probe.mjs`). Here: the server asks for it once, for the right
 * Tournament, and tells a failure from a Tournament that is gone.
 */
import { describe, expect, it } from 'vitest';
import { lastFunctionParams } from '../../common/testing/migration-function';
import { mockSupabase, type ChainResult } from '../../common/testing/supabase-chain';
import { withStampedRules } from './match-rules.fixtures';
import { restampUnstartedMatches } from './match-ruleset';

const TOURNAMENT = {
  id: 't1',
  ruleset_code: 'Generic_PointsCap',
  ruleset_version: '1',
  ruleset_content_hash: 'hash-of-the-new-rules',
};

// A decoy first: the stamp is this Tournament's, not the first row's.
const stamped = () =>
  mockSupabase(
    ...withStampedRules({
      tournaments: { rows: [{ id: 't-other', ruleset_code: 'TF_v1' }, TOURNAMENT] },
      phases: { rows: [{ id: 'pools', tournament_id: 't1' }] },
      matches: { rows: [] },
    }),
  );

/** A stamp that answers `result`, whatever Tournament it is asked for. */
const stampAnswering = (result: ChainResult) =>
  mockSupabase({}, { stamp_match_rules: () => result });

describe('restampUnstartedMatches', () => {
  it("asks the database once to stamp THIS Tournament's bouts, and writes no row itself", async () => {
    const supabase = stamped();

    await restampUnstartedMatches(supabase.service as never, 't1');

    expect(supabase.rpc.mock.calls).toEqual([['stamp_match_rules', { p_tournament_id: 't1' }]]);
    // The database's own write moves the bouts not started: a second write here would race it.
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.writes).toEqual([]);
  });

  // The double cannot see a renamed key: the call would reach a function that does not exist.
  it('calls the stamp with the argument names the migration defines', async () => {
    const supabase = stamped();

    await restampUnstartedMatches(supabase.service as never, 't1');

    expect(Object.keys(supabase.rpc.mock.calls[0]![1] ?? {})).toEqual(
      lastFunctionParams('stamp_match_rules'),
    );
  });

  // A Tournament deleted meanwhile has no bouts to move: the door that changed it is not failed.
  it('returns quietly for a Tournament that is gone', async () => {
    const supabase = stamped();

    await expect(
      restampUnstartedMatches(supabase.service as never, 't-gone'),
    ).resolves.toBeUndefined();
    expect(supabase.rpc.mock.calls).toEqual([['stamp_match_rules', { p_tournament_id: 't-gone' }]]);
    expect(supabase.writes).toEqual([]);
  });

  it('a stamp that failed is an error: the caller must not answer "saved"', async () => {
    const supabase = stampAnswering({ data: null, error: { message: 'the write was refused' } });

    await expect(restampUnstartedMatches(supabase.service as never, 't1')).rejects.toThrow(
      /^The bouts of t1 did not take its ruleset: the write was refused$/,
    );
  });

  // The database refuses a Tournament with no pair: no bout goes to TF_v1, and the caller hears it.
  it('a Tournament with no ruleset pair is an error, not a quiet return', async () => {
    const supabase = stampAnswering({
      data: null,
      error: {
        code: '23514',
        message: 'The Tournament has no ruleset pair to stamp on its bouts',
      },
    });

    await expect(restampUnstartedMatches(supabase.service as never, 't1')).rejects.toThrow(
      'The bouts of t1 did not take its ruleset: The Tournament has no ruleset pair',
    );
  });
});
