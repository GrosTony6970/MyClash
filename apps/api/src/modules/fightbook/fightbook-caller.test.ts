import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Identity } from '../../common/auth/identity';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { fightBookCaller, requireFightBookOn, requireProfile } from './fightbook-caller';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';
const request = (identity: Identity) => ({ identity }) as unknown as FastifyRequest;
const claimed: Identity = { kind: 'claimed', userId: ACCOUNT, email: null };

function db(rows: Record<string, unknown>[]) {
  return mockSupabase({ global_persons: { rows } });
}

describe('fightBookCaller', () => {
  it('refuses a signed-out caller with 401', async () => {
    await expect(
      fightBookCaller(request({ kind: 'anonymous' }), db([]).service as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each<Identity>([
    { kind: 'staff', staffId: 's', eventId: 'e' },
    { kind: 'guest', guestSessionId: 'g', personId: 'p', eventId: 'e' },
  ])('refuses a $kind login with 403: FightBook is a personal account’s', async (identity) => {
    await expect(
      fightBookCaller(request(identity), db([]).service as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("reads the account's live profile and its switch", async () => {
    const supabase = db([
      {
        id: MARC,
        claimed_by_user_id: ACCOUNT,
        fightbook_enabled: true,
        deleted_at: null,
        merged_into_id: null,
        account_deleted_at: null,
      },
    ]);
    expect(await fightBookCaller(request(claimed), supabase.service as never)).toEqual({
      userId: ACCOUNT,
      globalPersonId: MARC,
      enabled: true,
    });
    expect(selectsFor(supabase.from, 'global_persons')).toEqual(['id, fightbook_enabled']);
    // A merged-away, deleted or erased profile is not live (applyReachable).
    expect(filtersFor(supabase.from, 'global_persons', 'is')).toEqual([
      ['deleted_at', null],
      ['merged_into_id', null],
      ['account_deleted_at', null],
    ]);
  });

  it('answers no profile for an account that holds none', async () => {
    expect(await fightBookCaller(request(claimed), db([]).service as never)).toEqual({
      userId: ACCOUNT,
      globalPersonId: null,
      enabled: false,
    });
  });
});

describe('requireProfile and requireFightBookOn', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return ((e as ForbiddenException).getResponse() as { code?: string }).code;
    }
    return null;
  };

  it('refuse a caller with no profile, no_profile', () => {
    const none = { userId: ACCOUNT, globalPersonId: null, enabled: false };
    expect(code(() => requireProfile(none))).toBe('no_profile');
    expect(code(() => requireFightBookOn(none))).toBe('no_profile');
  });

  it('refuse a caller who switched FightBook off, fightbook_off, for everything but the profile', () => {
    const off = { userId: ACCOUNT, globalPersonId: MARC, enabled: false };
    expect(requireProfile(off)).toBe(MARC);
    expect(code(() => requireFightBookOn(off))).toBe('fightbook_off');
    expect(requireFightBookOn({ ...off, enabled: true })).toBe(MARC);
  });
});
