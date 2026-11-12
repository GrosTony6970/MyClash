import { NotFoundException, type HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  writesTo,
  type ChainResult,
} from '../../common/testing/supabase-chain';
import { SparRequestsService } from './spar-requests.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const REQUEST = '5b000000-0000-4000-8000-00000000000a';
const NOW = new Date('2026-05-22T12:00:00Z');

function setup({
  answer = { data: { asker: MARC, status: 'agreed' }, error: null } as ChainResult,
  update = { data: [{ id: REQUEST }], error: null } as ChainResult,
  row = {
    id: REQUEST,
    asker_global_person_id: MARC,
    receiver_global_person_id: JULIE,
    status: 'agreed',
  } as Record<string, unknown> | null,
} = {}) {
  const send = vi.fn(async () => undefined);
  const supabase = mockSupabase(
    {
      spar_requests: [{ data: row, error: null }, update],
      global_persons: {
        rows: [
          { id: MARC, claimed_by_user_id: 'acc-m' },
          { id: JULIE, claimed_by_user_id: 'acc-j' },
        ],
      },
    },
    { fightbook_answer: () => answer },
  );
  Object.assign(supabase, {
    getAuthAdminUser: vi.fn(async () => ({ ok: true, status: 200, data: { email: null } })),
  });
  const service = new SparRequestsService(supabase as never, { sendImmediate: send } as never);
  return { service, supabase, send };
}

async function codeOf(promise: Promise<unknown>): Promise<[number, string | undefined]> {
  try {
    await promise;
  } catch (e) {
    const err = e as HttpException;
    return [err.getStatus(), (err.getResponse() as { code?: string }).code];
  }
  return [0, undefined];
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SparRequestsService.answer', () => {
  it('answers as the caller, never as a body names, and tells the asker of a yes', async () => {
    const { service, supabase, send } = setup();
    expect(await service.answer(JULIE, REQUEST, { answer: 'yes' })).toEqual({ status: 'agreed' });
    expect(supabase.rpc).toHaveBeenCalledWith('fightbook_answer', {
      p_request: REQUEST,
      p_receiver: JULIE,
      p_answer: 'yes',
      p_comment: null,
      p_comment_shared: false,
    });
    await settle();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'spar_agreed', entityId: REQUEST, userId: 'acc-m' }),
    );
  });

  it('keeps a "Not this time" comment private unless shown, and tells nobody', async () => {
    const { service, supabase, send } = setup({
      answer: { data: { asker: MARC, status: 'not_this_time' }, error: null },
    });
    await service.answer(JULIE, REQUEST, { answer: 'no', comment: 'Not my weapon' });
    expect(supabase.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_answer: 'no',
      p_comment: 'Not my weapon',
      p_comment_shared: false,
    });
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['not_open', 409],
    ['bad_answer', 400],
  ])('answers the database’s %s with its code', async (word, status) => {
    const { service } = setup({ answer: { data: null, error: { code: 'P0001', message: word } } });
    expect(await codeOf(service.answer(PAUL, REQUEST, { answer: 'yes' }))).toEqual([status, word]);
  });
});

describe('SparRequestsService.withdraw', () => {
  it('takes back only my own request, still waiting and still open', async () => {
    const { service, supabase } = setup({ row: [{ id: REQUEST }] as never });
    await service.withdraw(MARC, REQUEST, NOW);
    const [write] = writesTo(supabase, 'spar_requests');
    expect(write?.row).toEqual({ status: 'withdrawn' });
    expect(filtersFor(supabase.from, 'spar_requests', 'eq')).toEqual([
      ['id', REQUEST],
      ['asker_global_person_id', MARC],
      ['status', 'pending'],
    ]);
    expect(filtersFor(supabase.from, 'spar_requests', 'gt')).toEqual([
      ['expires_at', NOW.toISOString()],
    ]);
  });

  it('answers not_open when nothing was left to take back', async () => {
    // Withdraw reads nothing first, so the table's first queued answer is its update's.
    const { service } = setup({ row: [] as never });
    expect(await codeOf(service.withdraw(MARC, REQUEST, NOW))).toEqual([409, 'not_open']);
  });
});

describe('SparRequestsService.cancel', () => {
  it('cancels as the side the caller is on, and tells the other fighter', async () => {
    const { service, supabase, send } = setup();
    await service.cancel(JULIE, REQUEST, 'Injured, sorry', NOW);
    expect(selectsFor(supabase.from, 'spar_requests')[0]).toBe(
      'id, asker_global_person_id, receiver_global_person_id, status',
    );
    const [write] = writesTo(supabase, 'spar_requests');
    expect(write?.row).toEqual({
      status: 'cancelled',
      cancelled_by: 'receiver',
      cancel_message: 'Injured, sorry',
    });
    expect(write?.filters.map((f) => f.args)).toEqual([
      ['id', REQUEST],
      ['status', 'agreed'],
      ['receiver_global_person_id', JULIE],
      // Ruling 677: a cancel after the day ends (`expires_at` not after now) lands on no row.
      ['expires_at', NOW.toISOString()],
    ]);
    await settle();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'spar_cancelled', userId: 'acc-m' }),
    );
  });

  it('answers 404 to a stranger: a 403 would confirm the request exists', async () => {
    const { service, send } = setup();
    await expect(service.cancel(PAUL, REQUEST, undefined)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it('answers not_open to a spar no longer agreed or past its day, and tells nobody', async () => {
    const { service, send } = setup({ update: { data: [], error: null } });
    expect(await codeOf(service.cancel(MARC, REQUEST, undefined, NOW))).toEqual([409, 'not_open']);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });
});
