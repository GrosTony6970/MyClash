/**
 * `PATCH me/follows/by-global-person/:globalPersonId/events`: a tap on a switch of a card of the
 * Following tab (operator ruling 239). Accounts only: a guest session has no card. What the save
 * does is `follows.card-switches.test.ts`'s.
 */
import { UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { cardSwitchesSchema, FollowsController } from './follows.controller';

const PAUL = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const MARC = 'u-marc';

describe('PATCH me/follows/by-global-person/:globalPersonId/events', () => {
  const follows = { setCardSwitches: vi.fn() };
  const guestJwt = { verify: vi.fn(() => ({ sub: 'g1', event_id: 'lyon' })) };
  const supabase = { getAuthUser: vi.fn(async (token: string) => ({ id: token })) };
  const controller = new FollowsController(
    follows as never,
    { list: vi.fn() } as never,
    guestJwt as never,
    supabase as never,
  );
  const as = (cookies: Record<string, string>) => ({ cookies }) as unknown as FastifyRequest;

  it('saves the tap for the signed-in account', async () => {
    follows.setCardSwitches.mockResolvedValue({ notifyRefereeStart: true });

    await controller.updateCardSwitches(
      PAUL,
      { notifyRefereeStart: true },
      as({ 'sb-access-token': MARC }),
    );

    expect(follows.setCardSwitches.mock.calls).toEqual([
      [
        PAUL,
        MARC,
        { notifyMatchStart: undefined, notifyWorkshopStart: undefined, notifyRefereeStart: true },
      ],
    ]);
  });

  it.each<[string, Record<string, string>]>([
    ['an anonymous caller', {}],
    ['a guest session: it has no card', { mc_guest: 'guest-token' }],
  ])('refuses %s with a 401, and saves nothing', async (_, cookies) => {
    follows.setCardSwitches.mockReset();

    await expect(
      controller.updateCardSwitches(PAUL, { notifyRefereeStart: true }, as(cookies)),
    ).rejects.toEqual(new UnauthorizedException('Sign in to set this alert'));

    expect(follows.setCardSwitches).not.toHaveBeenCalled();
  });

  it.each<[string, unknown, boolean]>([
    ['one switch', { notifyMatchStart: false }, true],
    [
      'the three switches',
      { notifyMatchStart: true, notifyWorkshopStart: true, notifyRefereeStart: false },
      true,
    ],
    ['no switch', {}, false],
    ['a switch that is no boolean', { notifyRefereeStart: 'true' }, false],
    ['another key', { notifyRefereeStart: true, eventId: 'lyon' }, false],
  ])('takes a body with %s: %s', (_, body, ok) => {
    expect(cardSwitchesSchema.safeParse(body).success).toBe(ok);
  });
});
