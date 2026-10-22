import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mockSupabase, writesTo, type SupabaseRow } from '../../common/testing/supabase-chain';
import { lastFunctionParams } from '../../common/testing/migration-function';
import type { FighterStatusService } from '../matches/fighter-status.service';
import type { SwissPairingService } from './swiss-pairing.service';
import type { SwissSeedingService } from './swiss-seeding.service';
import { asSupabase as as } from './swiss.fixtures';
import { FIGHTER_OUT } from './swiss-refusals';
import { SwissService } from './swiss.service';

/**
 * "Put back in the pairings" (rulings 108, 121, 122): through `swiss_put_back` (0244), under the
 * phase's row lock. What the function decides — any withdrawn entrant, the rounds missed recorded,
 * refused while the Fighter is out of the Tournament — is held on a real database by check 17 of
 * the RLS probe (`scripts/lib/swiss-status-probe.mjs`). Here: what the door sends, and what it
 * answers and records for each of the function's answers.
 */
type Answer = { data: unknown; error: { code?: string; message: string } | null };

const reinstating = (answer: Answer) => {
  const supabase = mockSupabase(
    { audit_log: { rows: [] as SupabaseRow[] } },
    { swiss_put_back: () => answer },
  );
  const service = new SwissService(
    as(supabase),
    {} as SwissPairingService,
    {} as SwissSeedingService,
    {} as FighterStatusService,
  );
  return { supabase, service };
};

const PUT_BACK: Answer = { data: { status: 'put_back', missedRounds: [3] }, error: null };

describe('SwissService.reinstate — putting a fighter back in the pairings', () => {
  it('asks the database to put the fighter back by the organiser’s hand', async () => {
    const { supabase, service } = reinstating(PUT_BACK);

    await expect(service.reinstate('p1', 'r2', 'u1')).resolves.toEqual({
      status: 'put_back',
      missedRounds: [3],
    });

    const [name, payload] = supabase.rpc.mock.calls[0]!;
    expect(name).toBe('swiss_put_back');
    expect(Object.keys(payload as object).sort()).toEqual(
      lastFunctionParams('swiss_put_back').sort(),
    );
    expect(payload).toEqual({ p_phase: 'p1', p_registration: 'r2', p_by: 'hand' });
    expect(writesTo(supabase, 'swiss_entrants')).toHaveLength(0);
  });

  it('records the put-back against the phase, with the rounds missed', async () => {
    const { supabase, service } = reinstating(PUT_BACK);

    await service.reinstate('p1', 'r2', '11111111-1111-4111-8111-111111111111');

    expect(writesTo(supabase, 'audit_log')[0]?.row).toMatchObject({
      actor_user_id: '11111111-1111-4111-8111-111111111111',
      action: 'swiss.reinstate',
      entity_type: 'phase',
      entity_id: 'p1',
      payload_json: { registrationId: 'r2', missedRounds: [3] },
    });
  });

  it('records nothing for a fighter who was paired already', async () => {
    const { supabase, service } = reinstating({
      data: { status: 'in', missedRounds: [] },
      error: null,
    });

    await expect(service.reinstate('p1', 'r2', 'u1')).resolves.toEqual({
      status: 'in',
      missedRounds: [],
    });
    expect(writesTo(supabase, 'audit_log')).toHaveLength(0);
  });

  it('refuses a fighter out of the tournament with its code', async () => {
    const { supabase, service } = reinstating({
      data: null,
      error: { code: 'P0001', message: 'fighter_out: registration r2 is withdrawn' },
    });

    const refused = await service.reinstate('p1', 'r2', 'u1').catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ConflictException);
    expect((refused as ConflictException).getResponse()).toMatchObject({ code: FIGHTER_OUT });
    expect(writesTo(supabase, 'audit_log')).toHaveLength(0);
  });

  it('reports a fighter who is not in this phase', async () => {
    const { service } = reinstating({
      data: null,
      error: { code: 'P0002', message: 'registration r9 is not in swiss phase p1' },
    });

    await expect(service.reinstate('p1', 'r9', 'u1')).rejects.toThrow(
      new NotFoundException('Fighter r9 is not in this Swiss phase'),
    );
  });

  it('surfaces any other failure, and an answer that says nothing', async () => {
    await expect(
      reinstating({ data: null, error: { code: '42501', message: 'denied' } }).service.reinstate(
        'p1',
        'r2',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      reinstating({ data: null, error: null }).service.reinstate('p1', 'r2'),
    ).rejects.toThrow(/was answered nothing/);
  });
});
