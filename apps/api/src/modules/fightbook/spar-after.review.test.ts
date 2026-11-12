import { NotFoundException, type HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { lastFunctionParams } from '../../common/testing/migration-function';
import {
  mockSupabase,
  selectsFor,
  writesTo,
  type ChainResult,
} from '../../common/testing/supabase-chain';
import { SparAfterService } from './spar-after.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const REQUEST = '5b000000-0000-4000-8000-00000000000a';
const TUESDAY = new Date('2026-05-26T06:00:00Z');
const SELECT =
  'id, asker_global_person_id, receiver_global_person_id, status, spar_day, zone, expires_at';

const row = (status: string) => ({
  id: REQUEST,
  asker_global_person_id: MARC,
  receiver_global_person_id: JULIE,
  status,
  spar_day: '2026-05-23',
  zone: 'Europe/Paris',
  expires_at: '2026-05-24T04:00:00+00:00',
});

/** `status: null` is a spar id that names no request. */
function setup(options: { status?: string | null; review?: ChainResult; note?: ChainResult } = {}) {
  const answer = vi.fn(
    (_args: Record<string, unknown>) => options.review ?? { data: null, error: null },
  );
  const found = options.status === null ? null : row(options.status ?? 'done');
  const supabase = mockSupabase(
    {
      spar_requests: { data: found, error: null },
      spar_private_notes: options.note ?? { data: null, error: null },
    },
    { fightbook_review: answer },
  );
  const service = new SparAfterService(supabase as never, { sendImmediate: vi.fn() } as never);
  return { service, supabase, answer };
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

describe('SparAfterService.review', () => {
  it('calls fightbook_review as the caller, on the service’s clock, with the function’s own keys', async () => {
    const { service, supabase } = setup();
    await service.review(JULIE, REQUEST, { stars: 4, text: 'Thanks!', anonymous: false }, TUESDAY);
    const [name, args] = supabase.rpc.mock.calls[0]!;
    expect(name).toBe('fightbook_review');
    expect(args).toEqual({
      p_request: REQUEST,
      p_author: JULIE,
      p_stars: 4,
      p_body: 'Thanks!',
      p_anonymous: false,
      p_now: TUESDAY.toISOString(),
    });
    // A double ignores the payload: a key renamed on either side would stay green without this.
    expect(Object.keys(args ?? {})).toEqual(lastFunctionParams('fightbook_review'));
  });

  it('sends no text with an anonymous review, whatever the body carried', async () => {
    const { service, supabase } = setup();
    await service.review(JULIE, REQUEST, { stars: 2, text: 'Signed?', anonymous: true }, TUESDAY);
    expect(supabase.rpc.mock.calls[0]![1]).toMatchObject({ p_body: null, p_anonymous: true });
  });

  it('sends a null text when there is none', async () => {
    const { service, supabase } = setup();
    await service.review(JULIE, REQUEST, { stars: 5, anonymous: false }, TUESDAY);
    expect(supabase.rpc.mock.calls[0]![1]).toMatchObject({ p_body: null });
  });

  it('answers 404 to a stranger, or a spar that does not exist, and calls nothing', async () => {
    const stranger = setup();
    await expect(
      stranger.service.review(PAUL, REQUEST, { stars: 3, anonymous: false }, TUESDAY),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(selectsFor(stranger.supabase.from, 'spar_requests')).toEqual([SELECT]);
    expect(stranger.supabase.rpc).not.toHaveBeenCalled();
    const missing = setup({ status: null });
    await expect(
      missing.service.review(JULIE, REQUEST, { stars: 3, anonymous: false }, TUESDAY),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(missing.supabase.rpc).not.toHaveBeenCalled();
  });

  it('answers 409 not_open when the database refuses', async () => {
    const { service } = setup({
      review: { data: null, error: { code: 'P0001', message: 'not_open' } },
    });
    expect(
      await codeOf(service.review(JULIE, REQUEST, { stars: 3, anonymous: false }, TUESDAY)),
    ).toEqual([409, 'not_open']);
  });

  it('answers a 5xx on any other database error', async () => {
    const { service } = setup({ review: { data: null, error: { code: '23514', message: 'x' } } });
    await expect(
      service.review(JULIE, REQUEST, { stars: 3, anonymous: false }, TUESDAY),
    ).rejects.not.toHaveProperty('getStatus');
  });
});

/** The `upsert` calls made on `spar_private_notes`, with their options. */
function upserts(supabase: ReturnType<typeof setup>['supabase']): unknown[][] {
  return supabase.from.mock.calls.flatMap(([table], i) => {
    const call = supabase.from.mock.results[i];
    if (table !== 'spar_private_notes' || call?.type !== 'return') return [];
    return call.value.upsert.mock.calls as unknown[][];
  });
}

describe('SparAfterService.setNote', () => {
  it('keeps one note per spar and writer: an upsert on (spar, author) of a done spar', async () => {
    const { service, supabase } = setup();
    await service.setNote(MARC, REQUEST, 'Work on my guard');
    expect(selectsFor(supabase.from, 'spar_requests')).toEqual([SELECT]);
    expect(upserts(supabase)).toEqual([
      [
        { spar_request_id: REQUEST, author_global_person_id: MARC, body: 'Work on my guard' },
        { onConflict: 'spar_request_id,author_global_person_id' },
      ],
    ]);
  });

  it('deletes only the caller’s own note on null', async () => {
    const { service, supabase } = setup();
    await service.setNote(JULIE, REQUEST, null);
    const [write] = writesTo(supabase, 'spar_private_notes');
    expect(write?.op).toBe('delete');
    expect(write?.filters.map((f) => f.args)).toEqual([
      ['spar_request_id', REQUEST],
      ['author_global_person_id', JULIE],
    ]);
  });

  it.each(['agreed', 'cancelled'])(
    'answers not_open on a %s spar, and writes nothing',
    async (status) => {
      const { service, supabase } = setup({ status });
      expect(await codeOf(service.setNote(MARC, REQUEST, 'Note'))).toEqual([409, 'not_open']);
      expect(await codeOf(service.setNote(MARC, REQUEST, null))).toEqual([409, 'not_open']);
      expect(writesTo(supabase, 'spar_private_notes')).toHaveLength(0);
    },
  );

  it('answers 404 to a stranger, and writes nothing', async () => {
    const { service, supabase } = setup();
    await expect(service.setNote(PAUL, REQUEST, 'Note')).rejects.toBeInstanceOf(NotFoundException);
    expect(writesTo(supabase, 'spar_private_notes')).toHaveLength(0);
  });

  it('answers a 5xx when the write fails', async () => {
    const { service } = setup({ note: { data: null, error: { message: 'boom' } } });
    await expect(service.setNote(MARC, REQUEST, 'Note')).rejects.toThrow('spar note failed');
  });
});
