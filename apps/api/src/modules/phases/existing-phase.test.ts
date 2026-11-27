import { Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { existingPhase } from './existing-phase';

const PHASES = [
  { id: 'pool-elsewhere', tournament_id: 'other', type: 'pool' },
  { id: 'bracket-here', tournament_id: 't-1', type: 'single_elim' },
  { id: 'pool-here', tournament_id: 't-1', type: 'pool' },
];

const db = (seed: Parameters<typeof mockSupabase>[0]) => mockSupabase(seed);

afterEach(() => vi.restoreAllMocks());

describe('existingPhase', () => {
  it("finds the Tournament's phase of the type asked, and asks for its id only", async () => {
    const supabase = db({ phases: { rows: PHASES } });
    const found = await existingPhase(supabase.service as unknown as SupabaseClient, 't-1', [
      'pool',
    ]);
    expect(found?.id).toBe('pool-here');
    expect(selectsFor(supabase.from, 'phases')).toEqual(['id']);
    expect(filtersFor(supabase.from, 'phases', 'eq')).toEqual([['tournament_id', 't-1']]);
    expect(filtersFor(supabase.from, 'phases', 'in')).toEqual([['type', ['pool']]]);
  });

  it('finds a bracket of either elimination type', async () => {
    const supabase = db({ phases: { rows: PHASES } });
    const found = await existingPhase(supabase.service as unknown as SupabaseClient, 't-1', [
      'single_elim',
      'double_elim',
    ]);
    expect(found?.id).toBe('bracket-here');
  });

  it('answers null when the Tournament has none', async () => {
    const supabase = db({ phases: { rows: PHASES } });
    const found = await existingPhase(supabase.service as unknown as SupabaseClient, 'other', [
      'double_elim',
    ]);
    expect(found).toBeNull();
  });

  it('throws on a failed read, never "none", and logs it', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const supabase = db({ phases: { data: null, error: { message: 'connection reset' } } });
    await expect(
      existingPhase(supabase.service as unknown as SupabaseClient, 't-1', ['pool']),
    ).rejects.toThrow('existing phase read failed: connection reset');
    expect(warn).toHaveBeenCalledWith('existing phase read failed: connection reset');
  });
});
