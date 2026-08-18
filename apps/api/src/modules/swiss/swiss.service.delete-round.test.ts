import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import type { SupabaseService } from '../supabase/supabase.service';
import type { SwissPairingService } from './swiss-pairing.service';
import type { SwissSeedingService } from './swiss-seeding.service';
import { SwissService } from './swiss.service';

/**
 * Deleting the last Swiss round.
 *
 * This is not a tidy-up path: `SwissAdvanceService.assertUncompletable` refuses
 * an un-completion by naming it — "Delete that round first" — so whatever blocks
 * it blocks the documented way out of a stuck phase.
 */
const as = (supabase: { service: unknown }): SupabaseService =>
  supabase as unknown as SupabaseService;

const contextWith = (matchStatuses: string[]) =>
  ({
    requireContext: vi.fn().mockResolvedValue({
      rounds: [
        {
          id: 'round-3',
          roundNumber: 3,
          matches: matchStatuses.map((status, i) => ({ id: `m${i}`, status })),
        },
      ],
    }),
  }) as unknown as SwissPairingService;

/** Reached only once the guard lets go: two deletes and the audit row. */
const writableSupabase = () =>
  mockSupabase({
    matches: { data: null, error: null },
    swiss_rounds: { data: null, error: null },
    audit_log: { data: null, error: null },
  });

const service = (matchStatuses: string[], supabase = writableSupabase()) =>
  new SwissService(as(supabase), contextWith(matchStatuses), {} as SwissSeedingService);

describe('SwissService.deleteRound', () => {
  it('deletes a round whose bouts are all still scheduled', async () => {
    await expect(service(['scheduled', 'scheduled']).deleteRound('p1', 3)).resolves.toEqual({
      deleted: 3,
    });
  });

  it('refuses a round holding a running, paused or completed bout', async () => {
    for (const status of ['running', 'paused', 'completed']) {
      await expect(service(['scheduled', status]).deleteRound('p1', 3)).rejects.toBeInstanceOf(
        ConflictException,
      );
    }
  });

  it('deletes a round whose only activity was voided', async () => {
    // `!== 'scheduled'` counted VOIDED as under way, so a voided bout in the
    // last round blocked the remedy that the un-completion refusal points the
    // organiser at — and there was nothing left to undo to clear it.
    await expect(service(['scheduled', 'voided']).deleteRound('p1', 3)).resolves.toEqual({
      deleted: 3,
    });
  });

  it('still refuses when a voided bout sits beside a fought one', async () => {
    await expect(service(['voided', 'completed']).deleteRound('p1', 3)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses to delete anything but the last round', async () => {
    await expect(service(['scheduled']).deleteRound('p1', 2)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  /**
   * A DELETE names its rows only through its filters, and a seeded table is a
   * fixture rather than a database — a delete changes nothing a later read can
   * see. So the scope is asserted by argument here, which is the only form
   * available and the reason the double records filters alongside writes.
   *
   * Both were held by nothing. Unscoped, the first statement empties `matches`
   * for the whole database and the second empties `swiss_rounds`.
   */
  it('deletes only the bouts of the round it was asked for', async () => {
    const supabase = writableSupabase();

    await service(['scheduled', 'scheduled'], supabase).deleteRound('p1', 3);

    expect(writesTo(supabase, 'matches')[0]).toMatchObject({
      op: 'delete',
      filters: [{ method: 'eq', args: ['swiss_round_id', 'round-3'] }],
    });
  });

  it('deletes only the round it was asked for', async () => {
    const supabase = writableSupabase();

    await service(['scheduled', 'scheduled'], supabase).deleteRound('p1', 3);

    expect(writesTo(supabase, 'swiss_rounds')[0]).toMatchObject({
      op: 'delete',
      filters: [{ method: 'eq', args: ['id', 'round-3'] }],
    });
  });

  it('deletes the bouts BEFORE the round that owns them', async () => {
    // matches.swiss_round_id is ON DELETE SET NULL, so dropping the round row
    // first orphans its bouts: they survive with a null round, invisible to
    // every Swiss read path and impossible to clear from the UI.
    const supabase = writableSupabase();

    await service(['scheduled'], supabase).deleteRound('p1', 3);

    const tables = supabase.writes.map((write) => write.table);
    expect(tables.indexOf('matches')).toBeLessThan(tables.indexOf('swiss_rounds'));
  });
});
