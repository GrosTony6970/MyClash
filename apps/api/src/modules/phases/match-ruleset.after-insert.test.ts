/**
 * New bouts take the ruleset in force after their write (operator, 2026-10-16, R3).
 *
 * One organiser switches the Tournament to the points-cap ruleset while another presses
 * "Generate Pools" in the same second. The generation read TF_v1 a moment before; the switch
 * re-stamped the bouts not started, and the forty new ones were not written yet. They were fought
 * under TF_v1. Each door that writes bouts asks for the re-stamp again after its write.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { withStampedRules } from './match-rules.fixtures';
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

const stamped = (over: Record<string, TableSeed> = {}) =>
  mockSupabase(...withStampedRules(seed(over)));

const STAMP_OF_T1 = ['stamp_match_rules', { p_tournament_id: 't1' }];

describe('restampAfterInsert', () => {
  it("re-stamps the bouts of the phase's Tournament with the ruleset in force", async () => {
    const supabase = stamped();
    const logger = { warn: vi.fn() };

    await restampAfterInsert(supabase.service as never, { phaseId: 'pools' }, logger);

    expect(selectsFor(supabase.from, 'phases')).toEqual(['tournament_id']);
    expect(filtersFor(supabase.from, 'phases', 'eq')).toEqual([['id', 'pools']]);
    expect(supabase.rpc.mock.calls).toEqual([STAMP_OF_T1]);
    // The database writes the bouts in its own stamp: no write from here.
    expect(supabase.writes).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('re-stamps the bouts of a Tournament named by its id, with no phase read', async () => {
    const supabase = stamped();

    await restampAfterInsert(supabase.service as never, { tournamentId: 't1' }, { warn: vi.fn() });

    expect(supabase.rpc.mock.calls).toEqual([STAMP_OF_T1]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  // The bouts are written: the door's answer stands, and the log says what was not done.
  it('logs a re-stamp that failed, and does not throw', async () => {
    const supabase = mockSupabase(seed(), {
      stamp_match_rules: () => ({ data: null, error: { message: 'the database is away' } }),
    });
    const logger = { warn: vi.fn() };

    await expect(
      restampAfterInsert(supabase.service as never, { tournamentId: 't1' }, logger),
    ).resolves.toBeUndefined();

    expect(supabase.rpc.mock.calls).toEqual([STAMP_OF_T1]);
    expect(logger.warn).toHaveBeenCalledWith(
      'New bouts were not re-stamped with the ruleset in force: ' +
        'The bouts of t1 did not take its ruleset: the database is away',
    );
  });

  it('logs a phase that could not be read, and stamps nothing', async () => {
    const supabase = stamped({
      phases: { data: null, error: { message: 'the database is away' } },
    });
    const logger = { warn: vi.fn() };

    await restampAfterInsert(supabase.service as never, { phaseId: 'pools' }, logger);

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('the database is away'));
  });

  it('logs a phase that is not found, and stamps nothing', async () => {
    const supabase = stamped();
    const logger = { warn: vi.fn() };

    await restampAfterInsert(supabase.service as never, { phaseId: 'phase-gone' }, logger);

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Phase phase-gone was not found'),
    );
  });
});
