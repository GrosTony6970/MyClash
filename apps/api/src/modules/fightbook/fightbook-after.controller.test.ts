import { ForbiddenException, ParseUUIDPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../common/auth/identity';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { FightBookAfterController } from './fightbook-after.controller';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';
const SPAR = '5d0c1f6e-2a3b-4c5d-8e9f-0a1b2c3d4e5f';
const claimed: Identity = { kind: 'claimed', userId: ACCOUNT, email: null };
const req = { identity: claimed } as unknown as FastifyRequest;

/** Marc's live profile with FightBook switched OFF: mark and undo need a profile, not the switch. */
function controller(profile = true) {
  const supabase = mockSupabase({
    global_persons: {
      rows: profile
        ? [
            {
              id: MARC,
              claimed_by_user_id: ACCOUNT,
              fightbook_enabled: false,
              deleted_at: null,
              merged_into_id: null,
              account_deleted_at: null,
            },
          ]
        : [],
    },
  });
  const after = {
    markDone: vi.fn(async () => undefined),
    undo: vi.fn(async () => undefined),
    review: vi.fn(async () => undefined),
    setNote: vi.fn(async () => undefined),
  };
  const thanks = { received: vi.fn(async () => ({ items: [], more: false })) };
  return {
    ctl: new FightBookAfterController(
      supabase as never,
      after as never,
      thanks as never,
      {} as never,
    ),
    after,
    thanks,
  };
}

const REVIEW = { stars: 4, text: 'Thanks!', anonymous: false };

describe('FightBookAfterController', () => {
  it('lets a fighter who switched FightBook off still finish a spar (666)', async () => {
    const { ctl, after, thanks } = controller();
    await ctl.done(SPAR, req);
    await ctl.undo(SPAR, req);
    await ctl.review(SPAR, REVIEW, req);
    await ctl.note(SPAR, { body: null }, req);
    await ctl.receivedThanks({ page: 2 }, req);
    expect(after.markDone).toHaveBeenCalledWith(MARC, SPAR);
    expect(after.undo).toHaveBeenCalledWith(MARC, SPAR);
    expect(after.review).toHaveBeenCalledWith(MARC, SPAR, REVIEW);
    expect(after.setNote).toHaveBeenCalledWith(MARC, SPAR, null);
    expect(thanks.received).toHaveBeenCalledWith(MARC, 2);
  });

  it('refuses an account with no fighter profile, and calls nothing', async () => {
    const { ctl, after, thanks } = controller(false);
    await expect(ctl.done(SPAR, req)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.undo(SPAR, req)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.review(SPAR, REVIEW, req)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.note(SPAR, { body: 'x' }, req)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.receivedThanks({ page: 0 }, req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(after.markDone).not.toHaveBeenCalled();
    expect(after.undo).not.toHaveBeenCalled();
    expect(after.review).not.toHaveBeenCalled();
    expect(after.setNote).not.toHaveBeenCalled();
    expect(thanks.received).not.toHaveBeenCalled();
  });

  it.each(['done', 'undo', 'review', 'note'] as const)(
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
