import { ForbiddenException, ParseUUIDPipe, UnauthorizedException } from '@nestjs/common';
import { HTTP_CODE_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../common/auth/identity';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { FightBookFloorController, pickSchema, postCallSchema } from './fightbook-floor.controller';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';
const EVENT = 'eeeeeeee-0000-4000-8000-00000000000a';
const CALL = 'ca000000-0000-4000-8000-000000000001';
const claimed: Identity = { kind: 'claimed', userId: ACCOUNT, email: null };
const req = (identity: Identity = claimed) => ({ identity }) as unknown as FastifyRequest;

/** Marc's live profile, FightBook switched OFF unless `on`; `hasProfile` false: no profile. */
function controller({ on = false, hasProfile = true } = {}) {
  const supabase = mockSupabase({
    global_persons: {
      rows: hasProfile
        ? [
            {
              id: MARC,
              claimed_by_user_id: ACCOUNT,
              fightbook_enabled: on,
              deleted_at: null,
              merged_into_id: null,
              account_deleted_at: null,
            },
          ]
        : [],
    },
  });
  const open = {
    read: vi.fn(async () => ({ mine: [], others: [] })),
    post: vi.fn(async () => ({ id: CALL })),
    close: vi.fn(async () => undefined),
    answer: vi.fn(async () => undefined),
    takeBack: vi.fn(async () => undefined),
    pick: vi.fn(async () => ({ requestId: 'spar-1' })),
  };
  const ctl = new FightBookFloorController(supabase as never, {} as never, open as never);
  return { ctl, open };
}

const code = async (call: Promise<unknown>) => {
  const error = await call.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ForbiddenException);
  return ((error as ForbiddenException).getResponse() as { code: string }).code;
};

const BODY = { weapons: ['Longsword'], time: '15:00' };

describe('FightBookFloorController, open calls that add presence: FightBook on', () => {
  it.each([
    [
      'readCalls',
      (c: FightBookFloorController) => c.readCalls(EVENT, req()),
      'read',
      [MARC, EVENT],
    ],
    [
      'postCall',
      (c: FightBookFloorController) => c.postCall(EVENT, BODY, req()),
      'post',
      [MARC, EVENT, BODY],
    ],
    [
      'answerCall',
      (c: FightBookFloorController) => c.answerCall(CALL, req()),
      'answer',
      [MARC, CALL],
    ],
    [
      'pickAnswer',
      (c: FightBookFloorController) => c.pickAnswer(CALL, { globalPersonId: PAUL }, req()),
      'pick',
      [MARC, CALL, PAUL],
    ],
  ] as const)('%s acts on my own profile', async (_, call, method, args) => {
    const { ctl, open } = controller({ on: true });
    await call(ctl);
    expect(open[method]).toHaveBeenCalledWith(...args);
  });

  it.each([
    ['readCalls', (c: FightBookFloorController) => c.readCalls(EVENT, req())],
    ['postCall', (c: FightBookFloorController) => c.postCall(EVENT, BODY, req())],
    ['answerCall', (c: FightBookFloorController) => c.answerCall(CALL, req())],
    [
      'pickAnswer',
      (c: FightBookFloorController) => c.pickAnswer(CALL, { globalPersonId: PAUL }, req()),
    ],
  ] as const)('%s is refused with FightBook off, and without a profile', async (_, call) => {
    expect(await code(call(controller().ctl))).toBe('fightbook_off');
    expect(await code(call(controller({ hasProfile: false }).ctl))).toBe('no_profile');
  });

  it('answers the post { id } and the pick { requestId }', async () => {
    const { ctl } = controller({ on: true });
    expect(await ctl.postCall(EVENT, BODY, req())).toEqual({ id: CALL });
    expect(await ctl.pickAnswer(CALL, { globalPersonId: PAUL }, req())).toEqual({
      requestId: 'spar-1',
    });
  });

  it('is 401 signed out and 403 for a staff login', async () => {
    const { ctl } = controller({ on: true });
    await expect(ctl.readCalls(EVENT, req({ kind: 'anonymous' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      ctl.postCall(EVENT, BODY, req({ kind: 'staff', userId: ACCOUNT } as unknown as Identity)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('FightBookFloorController, open calls that remove presence: a profile is enough', () => {
  it.each([
    ['closeCall', 'close'],
    ['takeBackAnswer', 'takeBack'],
  ] as const)('%s still works with FightBook off', async (name, method) => {
    const { ctl, open } = controller();
    await ctl[name](CALL, req());
    expect(open[method]).toHaveBeenCalledWith(MARC, CALL);
  });

  it.each(['closeCall', 'takeBackAnswer'] as const)('%s needs a profile', async (name) => {
    const { ctl, open } = controller({ hasProfile: false });
    expect(await code(ctl[name](CALL, req()))).toBe('no_profile');
    expect(open.close).not.toHaveBeenCalled();
    expect(open.takeBack).not.toHaveBeenCalled();
  });
});

describe('FightBookFloorController, open-call routes', () => {
  const meta = (name: string) =>
    Reflect.getMetadata(ROUTE_ARGS_METADATA, FightBookFloorController, name) as Record<
      string,
      { data?: string; pipes: unknown[] }
    >;

  it.each([
    ['readCalls', 'eventId'],
    ['postCall', 'eventId'],
    ['closeCall', 'id'],
    ['answerCall', 'id'],
    ['takeBackAnswer', 'id'],
    ['pickAnswer', 'id'],
  ])('%s checks its %s is a uuid', (name, param) => {
    const arg = Object.values(meta(name)).find((a) => a.data === param);
    expect(arg?.pipes).toContain(ParseUUIDPipe);
  });

  it.each([
    ['postCall', 201],
    ['closeCall', 204],
    ['answerCall', 204],
    ['takeBackAnswer', 204],
    ['pickAnswer', 201],
  ] as const)('%s answers %s', (name, status) => {
    const handler = FightBookFloorController.prototype[name];
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(status);
  });

  it('takes a post of 1-5 weapons and a time HH:MM, nothing else', () => {
    expect(postCallSchema.safeParse(BODY).success).toBe(true);
    for (const bad of [
      { ...BODY, time: '24:00' },
      { ...BODY, time: '9:00' },
      { ...BODY, weapons: [] },
      { ...BODY, weapons: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { ...BODY, place: 'Hall B' },
      { weapons: BODY.weapons },
    ]) {
      expect(postCallSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('takes a pick of one fighter id, nothing else', () => {
    expect(pickSchema.safeParse({ globalPersonId: PAUL }).success).toBe(true);
    expect(pickSchema.safeParse({ globalPersonId: 'paul' }).success).toBe(false);
    expect(pickSchema.safeParse({ globalPersonId: PAUL, note: 'x' }).success).toBe(false);
  });
});
