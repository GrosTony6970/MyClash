import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mockSupabase, writesTo, type SupabaseRow } from '../../common/testing/supabase-chain';
import { lastFunctionParams } from '../../common/testing/migration-function';
import { FOUGHT_STATUSES } from '../matches/fought-match';
import type { FighterStatusService } from '../matches/fighter-status.service';
import type { SwissPairingService } from './swiss-pairing.service';
import type { SwissSeedingService } from './swiss-seeding.service';
import { asSupabase as as } from './swiss.fixtures';
import { ROUND_HAS_RECORDS } from './swiss-refusals';
import { SwissService } from './swiss.service';

/**
 * Deleting the last Swiss round.
 *
 * This is not a tidy-up path: `SwissAdvanceService.assertUncompletable` refuses an un-completion
 * by naming it — "Delete that round first" — so whatever blocks it blocks the documented way out
 * of a stuck phase.
 *
 * One step, `swiss_delete_last_round` (0244): what it decides — only the last round; a voided bout
 * is no bout under way, a voided one beside a fought one still is; only that round's bouts, before
 * the round; a black card or a forfeit on its bouts refuses; its number forgotten from the missed
 * rounds — is held on a real database by check 17 of the RLS probe
 * (`scripts/lib/swiss-status-probe.mjs`). Here: what the door sends, and how it answers each of
 * the function's answers.
 */
type Answer = { data: unknown; error: { code?: string; message: string } | null };

const deleting = (answer: Answer) => {
  const supabase = mockSupabase(
    { audit_log: { rows: [] as SupabaseRow[] } },
    { swiss_delete_last_round: () => answer },
  );
  const service = new SwissService(
    as(supabase),
    {} as SwissPairingService,
    {} as SwissSeedingService,
    {} as FighterStatusService,
  );
  return { supabase, service };
};

const refusal = (message: string, code = 'P0001'): Answer => ({
  data: null,
  error: { code, message },
});

describe('SwissService.deleteRound', () => {
  it('asks the database to delete the round, with the statuses that mean "under way"', async () => {
    const { supabase, service } = deleting({ data: { matches: 2 }, error: null });

    await expect(service.deleteRound('p1', 3, 'u1')).resolves.toEqual({ deleted: 3 });

    const [name, payload] = supabase.rpc.mock.calls[0]!;
    expect(name).toBe('swiss_delete_last_round');
    expect(Object.keys(payload as object).sort()).toEqual(
      lastFunctionParams('swiss_delete_last_round').sort(),
    );
    // The list passed in, so the SQL never retypes it: a VOIDED bout is not under way.
    expect(payload).toEqual({ p_phase: 'p1', p_round: 3, p_fought: [...FOUGHT_STATUSES] });
    expect(writesTo(supabase, 'audit_log')[0]?.row).toMatchObject({
      action: 'swiss.round_delete',
      entity_id: 'p1',
      payload_json: { roundNumber: 3, matches: 2 },
    });
  });

  it('refuses anything but the last round, naming it', async () => {
    const { service } = deleting(refusal('not_last_round: 4'));

    const refused = await service.deleteRound('p1', 3).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ConflictException);
    expect((refused as ConflictException).message).toBe(
      'Only the last round (4) can be deleted; rounds are cumulative.',
    );
  });

  it('refuses a round with a bout under way', async () => {
    const { service } = deleting(refusal('round_under_way'));

    await expect(service.deleteRound('p1', 3)).rejects.toThrow(
      new ConflictException('Round 3 has a bout under way'),
    );
  });

  it('refuses a round holding a black card or a forfeit, with its code', async () => {
    const { supabase, service } = deleting(refusal('round_has_records'));

    const refused = await service.deleteRound('p1', 3).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ConflictException);
    expect((refused as ConflictException).getResponse()).toMatchObject({ code: ROUND_HAS_RECORDS });
    expect(writesTo(supabase, 'audit_log')).toHaveLength(0);
  });

  it('answers a phase with no rounds as not found', async () => {
    const { service } = deleting(refusal('swiss phase p1 has no rounds', 'P0002'));

    await expect(service.deleteRound('p1', 1)).rejects.toThrow(
      new NotFoundException('This phase has no rounds'),
    );
  });

  it('surfaces any other failure, and an answer that says nothing', async () => {
    await expect(
      deleting(refusal('denied', '42501')).service.deleteRound('p1', 3),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      deleting({ data: null, error: null }).service.deleteRound('p1', 3),
    ).rejects.toThrow(/was answered nothing/);
  });
});
