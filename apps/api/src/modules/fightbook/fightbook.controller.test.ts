import { ForbiddenException, ParseUUIDPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../common/auth/identity';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { askableQuerySchema, FightBookController } from './fightbook.controller';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';
const SPAR = '5d0c1f6e-2a3b-4c5d-8e9f-0a1b2c3d4e5f';
const claimed: Identity = { kind: 'claimed', userId: ACCOUNT, email: null };
const req = { identity: claimed } as unknown as FastifyRequest;

/** Marc's live profile, FightBook switched OFF. */
function controller() {
  const supabase = mockSupabase({
    global_persons: {
      rows: [
        {
          id: MARC,
          claimed_by_user_id: ACCOUNT,
          fightbook_enabled: false,
          deleted_at: null,
          merged_into_id: null,
          account_deleted_at: null,
        },
      ],
    },
  });
  const reads = { mySpars: vi.fn(async () => ({ spars: [], sent: [] })), inbox: vi.fn() };
  const requests = {
    cancel: vi.fn(async () => undefined),
    ask: vi.fn(),
    answer: vi.fn(),
    withdraw: vi.fn(),
  };
  const find = { askableFighter: vi.fn(), askableAtEvent: vi.fn() };
  const ctl = new FightBookController(
    supabase as never,
    {} as never,
    requests as never,
    reads as never,
    {} as never,
    find as never,
  );
  return { ctl, reads, requests, find };
}

const code = async (call: Promise<unknown>) => {
  const error = await call.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ForbiddenException);
  return ((error as ForbiddenException).getResponse() as { code: string }).code;
};

describe('FightBookController, a fighter who switched FightBook off', () => {
  it('still reads My spars (ruling 666: Julie keeps the Saturday she agreed)', async () => {
    const { ctl, reads } = controller();
    await ctl.spars(req);
    expect(reads.mySpars).toHaveBeenCalledWith(MARC);
  });

  it('still cancels an agreed spar', async () => {
    const { ctl, requests } = controller();
    await ctl.cancel(SPAR, { message: 'Sick' } as never, req);
    expect(requests.cancel).toHaveBeenCalledWith(MARC, SPAR, 'Sick');
  });

  it('still takes back a request left waiting (the switch-off withdraw failed half way)', async () => {
    const { ctl, requests } = controller();
    await ctl.withdraw(SPAR, req);
    expect(requests.withdraw).toHaveBeenCalledWith(MARC, SPAR);
  });

  it('may not ask, answer or read the Inbox', async () => {
    const { ctl, reads, requests } = controller();
    expect(await code(ctl.ask({} as never, req))).toBe('fightbook_off');
    expect(await code(ctl.answer(SPAR, { answer: 'yes' } as never, req))).toBe('fightbook_off');
    expect(await code(ctl.inbox(req))).toBe('fightbook_off');
    expect(reads.inbox).not.toHaveBeenCalled();
    expect([requests.ask, requests.answer].flatMap((f) => f.mock.calls)).toEqual([]);
  });

  it('may not ask who is askable, on a profile or at an Event', async () => {
    const { ctl, find } = controller();
    expect(await code(ctl.askableFighter(SPAR, req))).toBe('fightbook_off');
    expect(await code(ctl.askableAtEvent(SPAR, { persons: [SPAR] } as never, req))).toBe(
      'fightbook_off',
    );
    expect([find.askableFighter, find.askableAtEvent].flatMap((f) => f.mock.calls)).toEqual([]);
  });
});

describe('FightBookController, the askable routes', () => {
  const uuids = (n: number) =>
    Array.from({ length: n }, (_, i) => `5d0c1f6e-2a3b-4c5d-8e9f-${String(i).padStart(12, '0')}`);

  it('takes 1 to 50 roster ids, each a uuid', () => {
    const parse = (persons: string) => askableQuerySchema.safeParse({ persons });
    expect(parse(uuids(50).join(',')).data).toEqual({ persons: uuids(50) });
    expect(parse('').success).toBe(false);
    expect(parse(uuids(51).join(',')).success).toBe(false);
    expect(parse(`${SPAR},not-a-uuid`).success).toBe(false);
  });

  // A direct handler call never runs a pipe: the route's own metadata is what Nest runs.
  it.each([
    ['askableFighter', 'globalPersonId'],
    ['askableAtEvent', 'eventId'],
  ])('%s parses its %s as a uuid', (handler, name) => {
    const args = Object.values(
      Reflect.getMetadata(ROUTE_ARGS_METADATA, FightBookController, handler) as Record<
        string,
        { data?: string; pipes: unknown[] }
      >,
    );
    expect(args.find((arg) => arg.data === name)?.pipes).toContain(ParseUUIDPipe);
  });
});
