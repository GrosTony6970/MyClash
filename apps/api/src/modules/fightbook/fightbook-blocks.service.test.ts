import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  writesTo,
  type ChainResult,
} from '../../common/testing/supabase-chain';
import { FightBookBlocksService } from './fightbook-blocks.service';
import { SparRequestsService } from './spar-requests.service';

const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';

function blocks(answer: ChainResult = { data: null, error: null }) {
  const supabase = mockSupabase(
    {
      fightbook_blocks: {
        rows: [
          {
            id: 'b-1',
            blocker_global_person_id: JULIE,
            blocked_global_person_id: MARC,
            created_at: '2026-05-01',
          },
        ],
      },
      global_persons: {
        rows: [
          {
            id: MARC,
            display_name: null,
            given_name: 'Marc',
            family_name: 'Probe',
            photo_url: null,
          },
        ],
      },
    },
    { fightbook_block: () => answer },
  );
  return { service: new FightBookBlocksService(supabase as never), supabase };
}

describe('FightBookBlocksService', () => {
  it('blocks as the caller, never as a body names', async () => {
    const { service, supabase } = blocks();
    await service.block(JULIE, MARC);
    expect(supabase.rpc).toHaveBeenCalledWith('fightbook_block', {
      p_blocker: JULIE,
      p_blocked: MARC,
    });
  });

  it('refuses blocking yourself, and nobody: 400 and 404', async () => {
    await expect(
      blocks({ data: null, error: { code: 'P0001', message: 'self' } }).service.block(JULIE, JULIE),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      blocks({ data: null, error: { code: 'P0002', message: 'not_found' } }).service.block(
        JULIE,
        MARC,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists the fighters I blocked, by name, and nothing about who blocked me', async () => {
    const { service, supabase } = blocks();
    expect(await service.list(JULIE)).toEqual([
      { fighter: { globalPersonId: MARC, name: 'Marc Probe', photoUrl: null } },
    ]);
    expect(selectsFor(supabase.from, 'fightbook_blocks')).toEqual([
      'blocked_global_person_id, created_at',
    ]);
    expect(filtersFor(supabase.from, 'fightbook_blocks', 'eq')).toEqual([
      ['blocker_global_person_id', JULIE],
    ]);
  });

  it('unblocks only my own block', async () => {
    const { service, supabase } = blocks();
    await service.unblock(JULIE, MARC);
    const [write] = writesTo(supabase, 'fightbook_blocks');
    expect(write?.op).toBe('delete');
    expect(write?.filters.map((f) => f.args)).toEqual([
      ['blocker_global_person_id', JULIE],
      ['blocked_global_person_id', MARC],
    ]);
  });
});

describe('a blocked fighter notices nothing', () => {
  it('their ask answers what any ask answers, and nobody is told', async () => {
    const answers = { pending: 'pending', blocked: 'not_this_time' } as const;
    const results: Record<string, unknown> = {};
    const sends: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const [name, status] of Object.entries(answers)) {
      const supabase = mockSupabase(
        {
          weapon_catalog: { rows: [{ name: 'Longsword', active: true }] },
          global_persons: { rows: [{ id: JULIE, claimed_by_user_id: 'acc-j' }] },
        },
        { fightbook_ask: () => ({ data: { id: 'r-1', status }, error: null }) },
      );
      Object.assign(supabase, {
        getAuthAdminUser: vi.fn(async () => ({ ok: true, status: 200, data: { email: null } })),
      });
      const send = vi.fn(async () => undefined);
      sends[name] = send;
      const requests = new SparRequestsService(supabase as never, { sendImmediate: send } as never);
      results[name] = await requests.ask(
        MARC,
        {
          receiverGlobalPersonId: JULIE,
          kind: 'free',
          day: '2026-05-22',
          zone: 'Europe/Paris',
          place: 'Salle',
          weapons: ['Longsword'],
        },
        new Date('2026-05-20T10:00:00Z'),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(results['blocked']).toEqual(results['pending']);
    expect(sends['pending']).toHaveBeenCalledTimes(1);
    expect(sends['blocked']).not.toHaveBeenCalled();
  });
});
