/**
 * New bouts take the ruleset in force after their write (operator, 2026-10-16, R3).
 *
 * One organiser switches the Tournament to the points-cap ruleset while another presses
 * "Generate Pools" in the same second. The generation read TF_v1 a moment before; the switch
 * re-stamped the bouts not started, and the forty new ones were not written yet. They were fought
 * under TF_v1. Each door that writes bouts asks for the re-stamp again after its write.
 */
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo, type TableSeed } from '../../common/testing/supabase-chain';
import { restampAfterInsert } from './match-ruleset';

const seed = (over: Record<string, TableSeed> = {}): Record<string, TableSeed> => ({
  tournaments: {
    rows: [
      { id: 't-other', ruleset_code: 'TF_v1' },
      { id: 't1', ruleset_code: 'Generic_PointsCap', ruleset_version: '1' },
    ],
  },
  phases: {
    rows: [
      { id: 'phase-other', tournament_id: 't-other' },
      { id: 'pools', tournament_id: 't1' },
    ],
  },
  matches: { rows: [] },
  ...over,
});

const restampOf = (supabase: ReturnType<typeof mockSupabase>) => {
  const write = writesTo(supabase, 'matches')[0];
  return {
    row: write?.row,
    phases: write?.filters.filter((filter) => filter.method === 'in').map((f) => f.args),
  };
};

describe('restampAfterInsert', () => {
  it("re-stamps the bouts of the phase's Tournament with the ruleset in force", async () => {
    const supabase = mockSupabase(seed());
    const logger = { warn: vi.fn() };

    await restampAfterInsert(supabase.service as never, { phaseId: 'pools' }, logger);

    expect(restampOf(supabase)).toEqual({
      row: {
        ruleset_code: 'Generic_PointsCap',
        ruleset_version: '1.0.0',
        ruleset_content_hash: null,
      },
      phases: [['phase_id', ['pools']]],
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('re-stamps the bouts of a Tournament named by its id', async () => {
    const supabase = mockSupabase(seed());

    await restampAfterInsert(supabase.service as never, { tournamentId: 't1' }, { warn: vi.fn() });

    expect(restampOf(supabase).phases).toEqual([['phase_id', ['pools']]]);
  });

  // The bouts are written: the door's answer stands, and the log says what was not done.
  it('logs a re-stamp that failed, and does not throw', async () => {
    const supabase = mockSupabase(
      seed({ tournaments: { data: null, error: { message: 'the database is away' } } }),
    );
    const logger = { warn: vi.fn() };

    await expect(
      restampAfterInsert(supabase.service as never, { tournamentId: 't1' }, logger),
    ).resolves.toBeUndefined();

    expect(writesTo(supabase, 'matches')).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('the database is away'));
  });

  it('logs a phase that could not be read', async () => {
    const supabase = mockSupabase(
      seed({ phases: { data: null, error: { message: 'the database is away' } } }),
    );
    const logger = { warn: vi.fn() };

    await restampAfterInsert(supabase.service as never, { phaseId: 'pools' }, logger);

    expect(writesTo(supabase, 'matches')).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('the database is away'));
  });
});
