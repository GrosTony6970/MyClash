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
  const after = { markDone: vi.fn(async () => undefined), undo: vi.fn(async () => undefined) };
  return { ctl: new FightBookAfterController(supabase as never, after as never), after };
}

describe('FightBookAfterController', () => {
  it('lets a fighter who switched FightBook off still mark a spar done and undo it (666)', async () => {
    const { ctl, after } = controller();
    await ctl.done(SPAR, req);
    await ctl.undo(SPAR, req);
    expect(after.markDone).toHaveBeenCalledWith(MARC, SPAR);
    expect(after.undo).toHaveBeenCalledWith(MARC, SPAR);
  });

  it('refuses an account with no fighter profile, and calls nothing', async () => {
    const { ctl, after } = controller(false);
    await expect(ctl.done(SPAR, req)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.undo(SPAR, req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(after.markDone).not.toHaveBeenCalled();
    expect(after.undo).not.toHaveBeenCalled();
  });

  it.each(['done', 'undo'] as const)('%s takes its id through ParseUUIDPipe', (route) => {
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      FightBookAfterController,
      route,
    ) as Record<string, { pipes: unknown[] }>;
    expect(Object.values(args).some((a) => a.pipes.includes(ParseUUIDPipe))).toBe(true);
  });
});
