import { ForbiddenException, ParseUUIDPipe, UnauthorizedException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../common/auth/identity';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { FightBookFloorController } from './fightbook-floor.controller';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';
const EVENT = 'eeeeeeee-0000-4000-8000-00000000000a';
const claimed: Identity = { kind: 'claimed', userId: ACCOUNT, email: null };
const req = (identity: Identity) => ({ identity }) as unknown as FastifyRequest;

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
  const freeNow = {
    switchOn: vi.fn(async () => ({ until: '2026-05-23T19:00:00.000Z' })),
    switchOff: vi.fn(async () => undefined),
  };
  return {
    ctl: new FightBookFloorController(supabase as never, freeNow as never, {} as never),
    freeNow,
  };
}

const code = async (call: Promise<unknown>) => {
  const error = await call.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ForbiddenException);
  return ((error as ForbiddenException).getResponse() as { code: string }).code;
};

describe('FightBookFloorController, switching on', () => {
  it('acts on the caller own profile and answers the time', async () => {
    const { ctl, freeNow } = controller({ on: true });
    expect(await ctl.switchOn(EVENT, req(claimed))).toEqual({ until: '2026-05-23T19:00:00.000Z' });
    expect(freeNow.switchOn).toHaveBeenCalledWith(MARC, EVENT);
  });

  it('is refused when FightBook is off (it adds presence)', async () => {
    const { ctl, freeNow } = controller();
    expect(await code(ctl.switchOn(EVENT, req(claimed)))).toBe('fightbook_off');
    expect(freeNow.switchOn).not.toHaveBeenCalled();
  });

  it('is refused without a profile', async () => {
    const { ctl, freeNow } = controller({ hasProfile: false });
    expect(await code(ctl.switchOn(EVENT, req(claimed)))).toBe('no_profile');
    expect(freeNow.switchOn).not.toHaveBeenCalled();
  });

  it('is 401 signed out and 403 for a staff login', async () => {
    const { ctl } = controller({ on: true });
    await expect(ctl.switchOn(EVENT, req({ kind: 'anonymous' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      ctl.switchOn(EVENT, req({ kind: 'staff', userId: ACCOUNT } as unknown as Identity)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('FightBookFloorController, switching off', () => {
  it('still works with FightBook off: an off fighter can always withdraw', async () => {
    const { ctl, freeNow } = controller();
    await ctl.switchOff(EVENT, req(claimed));
    expect(freeNow.switchOff).toHaveBeenCalledWith(MARC, EVENT);
  });

  it('needs a profile', async () => {
    const { ctl, freeNow } = controller({ hasProfile: false });
    expect(await code(ctl.switchOff(EVENT, req(claimed)))).toBe('no_profile');
    expect(freeNow.switchOff).not.toHaveBeenCalled();
  });
});

describe('FightBookFloorController, the Event id', () => {
  it.each(['switchOn', 'switchOff'] as const)('%s checks it is a uuid', (name) => {
    const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, FightBookFloorController, name) as Record<
      string,
      { data?: string; pipes: unknown[] }
    >;
    const param = Object.values(meta).find((arg) => arg.data === 'eventId');
    expect(param?.pipes).toContain(ParseUUIDPipe);
  });
});
