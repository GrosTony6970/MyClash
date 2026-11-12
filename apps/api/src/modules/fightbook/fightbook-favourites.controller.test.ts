import { ForbiddenException, ParseUUIDPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../common/auth/identity';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { FightBookAfterController } from './fightbook-after.controller';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';
const claimed: Identity = { kind: 'claimed', userId: ACCOUNT, email: null };
const req = { identity: claimed } as unknown as FastifyRequest;

/** Marc's live profile, FightBook switched on or off. */
function controller(on: boolean) {
  const supabase = mockSupabase({
    global_persons: {
      rows: [
        {
          id: MARC,
          claimed_by_user_id: ACCOUNT,
          fightbook_enabled: on,
          deleted_at: null,
          merged_into_id: null,
          account_deleted_at: null,
        },
      ],
    },
  });
  const favourites = {
    list: vi.fn(async () => []),
    add: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  const ctl = new FightBookAfterController(
    supabase as never,
    {} as never,
    {} as never,
    favourites as never,
    {} as never,
  );
  return { ctl, favourites };
}

describe('FightBookAfterController, favourites', () => {
  it('acts as the caller, never as a body or a path names', async () => {
    const { ctl, favourites } = controller(true);
    await ctl.favourites(req);
    await ctl.addFavourite(JULIE, req);
    await ctl.removeFavourite(JULIE, req);
    expect(favourites.list).toHaveBeenCalledWith(MARC);
    expect(favourites.add).toHaveBeenCalledWith(MARC, JULIE);
    expect(favourites.remove).toHaveBeenCalledWith(MARC, JULIE);
  });

  it('needs FightBook on: fightbook_off for all three, and nothing is called', async () => {
    const { ctl, favourites } = controller(false);
    for (const call of [
      ctl.favourites(req),
      ctl.addFavourite(JULIE, req),
      ctl.removeFavourite(JULIE, req),
    ]) {
      const error = await call.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'fightbook_off' });
    }
    expect(favourites.list).not.toHaveBeenCalled();
    expect(favourites.add).not.toHaveBeenCalled();
    expect(favourites.remove).not.toHaveBeenCalled();
  });

  it.each(['addFavourite', 'removeFavourite'] as const)(
    '%s takes its id through ParseUUIDPipe',
    (route) => {
      const args = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        FightBookAfterController,
        route,
      ) as Record<string, { pipes: unknown[] }>;
      expect(Object.values(args).some((a) => a.pipes.includes(ParseUUIDPipe))).toBe(true);
    },
  );
});
