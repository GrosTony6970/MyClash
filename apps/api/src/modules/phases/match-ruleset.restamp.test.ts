/**
 * The bouts of a Tournament that have not started take its ruleset (operator,
 * 2026-10-11).
 *
 * An organiser generates the Pools under TF_v1, then switches the Tournament to
 * the points-cap ruleset before the first bout. The Pool table was computed
 * with the new ruleset and every bout was scored with the old one, because a
 * bout is scored with the pair stamped on its own row and nothing stamped it
 * again.
 */
import { describe, expect, it } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  writesTo,
  type RecordedWrite,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { restampUnstartedMatches } from './match-ruleset';

const TOURNAMENT = {
  id: 't1',
  ruleset_code: 'Generic_PointsCap',
  ruleset_version: '1',
  ruleset_content_hash: 'hash-of-the-new-rules',
};

const seed = (over: Record<string, TableSeed> = {}): Record<string, TableSeed> => ({
  // A decoy first: the pair is this Tournament's, not the first row's.
  tournaments: { rows: [{ id: 't-other', ruleset_code: 'TF_v1' }, TOURNAMENT] },
  phases: {
    rows: [
      { id: 'phase-other', tournament_id: 't-other' },
      { id: 'pools', tournament_id: 't1' },
      { id: 'bracket', tournament_id: 't1' },
    ],
  },
  matches: { rows: [] },
  ...over,
});

const filterOf = (write: RecordedWrite, method: string) =>
  write.filters.filter((filter) => filter.method === method).map((filter) => filter.args);

describe('restampUnstartedMatches', () => {
  it("writes the Tournament's pair and hash on its bouts, the version normalized", async () => {
    const supabase = mockSupabase(seed());

    await restampUnstartedMatches(supabase.service as never, 't1');

    const writes = writesTo(supabase, 'matches');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.op).toBe('update');
    expect(writes[0]?.row).toEqual({
      ruleset_code: 'Generic_PointsCap',
      ruleset_version: '1.0.0',
      ruleset_content_hash: 'hash-of-the-new-rules',
    });
    expect(selectsFor(supabase.from, 'tournaments')).toEqual([
      'ruleset_code, ruleset_version, ruleset_content_hash',
    ]);
  });

  it('moves the bouts of THIS Tournament only, and only the ones not started', async () => {
    const supabase = mockSupabase(seed());

    await restampUnstartedMatches(supabase.service as never, 't1');

    const write = writesTo(supabase, 'matches')[0];
    // Every phase of the Tournament, and no phase of another one.
    expect(filterOf(write!, 'in')).toEqual([['phase_id', ['pools', 'bracket']]]);
    // A bout that started, or is finished, keeps the pair it was fought under.
    // Asked in the write itself: a bout that starts meanwhile is not moved.
    expect(filterOf(write!, 'eq')).toEqual([['status', 'scheduled']]);
    expect(selectsFor(supabase.from, 'phases')).toEqual(['id']);
  });

  it('writes nothing for a Tournament with no phase yet', async () => {
    const supabase = mockSupabase(
      seed({ phases: { rows: [{ id: 'phase-other', tournament_id: 't-other' }] } }),
    );

    await restampUnstartedMatches(supabase.service as never, 't1');

    expect(supabase.writes).toEqual([]);
  });

  it('writes nothing for a Tournament that is gone, even with a phase left behind', async () => {
    // With no row, the stamp would fall back to TF_v1 and be written.
    const supabase = mockSupabase(
      seed({ phases: { rows: [{ id: 'left-behind', tournament_id: 't-gone' }] } }),
    );

    await restampUnstartedMatches(supabase.service as never, 't-gone');

    expect(supabase.writes).toEqual([]);
  });

  it('a Tournament that could not be read is an error, and no bout goes to TF_v1', async () => {
    const supabase = mockSupabase(
      seed({ tournaments: { data: null, error: { message: 'the database is away' } } }),
    );

    await expect(restampUnstartedMatches(supabase.service as never, 't1')).rejects.toThrow(
      'Tournament t1 was not read: the database is away',
    );
    expect(supabase.writes).toEqual([]);
  });

  it('phases that could not be read are an error', async () => {
    const supabase = mockSupabase(
      seed({ phases: { data: null, error: { message: 'the database is away' } } }),
    );

    await expect(restampUnstartedMatches(supabase.service as never, 't1')).rejects.toThrow(
      'The phases of t1 were not read: the database is away',
    );
    expect(supabase.writes).toEqual([]);
  });

  it('a write that failed is an error: the caller must not answer "saved"', async () => {
    const supabase = mockSupabase(
      seed({ matches: { data: null, error: { message: 'the write was refused' } } }),
    );

    await expect(restampUnstartedMatches(supabase.service as never, 't1')).rejects.toThrow(
      'The bouts of t1 did not take its ruleset: the write was refused',
    );
  });
});
