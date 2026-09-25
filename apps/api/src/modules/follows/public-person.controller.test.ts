/**
 * The @Public door onto the public person page's header (ruling 121a): what the controller hands
 * the service. The bar itself is `public-person.service.test.ts`.
 */
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ANONYMOUS_USER_ID } from '../../common/auth/request-user';
import { PublicPersonController } from './public-person.controller';

const EVENT = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';

function door() {
  const people = { getProfile: vi.fn().mockResolvedValue({ id: PERSON }) };
  const guestJwt = {
    verify: vi.fn((token: string) => {
      if (token !== 'good-guest') throw new Error('bad token');
      return { sub: 'guest-session-1', event_id: EVENT };
    }),
  };
  // `getAuthUser` owns the GoTrue-then-local check (supabase.service.test.ts pins its outage path).
  const supabase = {
    getAuthUser: vi.fn(async (token: string) =>
      token === 'good-login' ? { id: 'fan-user' } : null,
    ),
  };
  const controller = new PublicPersonController(
    people as never,
    guestJwt as never,
    supabase as never,
  );
  return { controller, people };
}

const request = (fields: Record<string, unknown>) => fields as unknown as FastifyRequest;

describe('GET /events/:eventId/people/:personId (ruling 121a)', () => {
  it('reads as the caller the guard verified, with its staff session', async () => {
    const { controller, people } = door();
    const staffSession = { staffId: 's1', eventId: EVENT };
    await controller.getProfile(
      EVENT,
      PERSON,
      request({ identity: { kind: 'claimed', userId: 'member-user', email: null }, staffSession }),
    );
    expect(people.getProfile).toHaveBeenCalledWith(
      EVENT,
      PERSON,
      { userId: 'member-user', staff: staffSession },
      expect.any(Function),
    );
  });

  it('reads as anonymous when the guard found nobody', async () => {
    const { controller, people } = door();
    await controller.getProfile(EVENT, PERSON, request({}));
    expect(people.getProfile.mock.calls[0]?.[2]).toEqual({
      userId: ANONYMOUS_USER_ID,
      staff: null,
    });
  });

  it.each([
    [
      'a signed-in viewer follows as their account',
      { 'sb-access-token': 'good-login' },
      { userId: 'fan-user' },
    ],
    [
      'a guest follows as their guest session',
      { mc_guest: 'good-guest' },
      { guestSessionId: 'guest-session-1', guestEventId: EVENT },
    ],
    ['a forged guest cookie is nobody', { mc_guest: 'forged' }, {}],
    ['no cookie is nobody', {}, {}],
  ])('%s', async (_case, cookies, identity) => {
    const { controller, people } = door();
    await controller.getProfile(EVENT, PERSON, request({ cookies }));
    const resolveFollower = people.getProfile.mock.calls[0]?.[3] as () => Promise<unknown>;
    await expect(resolveFollower()).resolves.toEqual(identity);
  });
});
