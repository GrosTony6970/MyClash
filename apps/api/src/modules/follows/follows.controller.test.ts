/**
 * `POST /events/:eventId/follows` hands the service the reader the guard verified and the follower
 * the follows routes resolve, so the public person page's bar can hold (ruling 130; the bar
 * itself is follows.public-bar.test.ts).
 */
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ANONYMOUS_USER_ID } from '../../common/auth/request-user';
import { FollowsController } from './follows.controller';

const EVENT = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';

describe('POST /events/:eventId/follows (ruling 130)', () => {
  it("a guest follows through the bar, with their session's Event", async () => {
    const follows = { followInEvent: vi.fn().mockResolvedValue({}) };
    const guestJwt = { verify: vi.fn(() => ({ sub: 'g1', event_id: EVENT })) };
    const controller = new FollowsController(
      follows as never,
      {} as never,
      guestJwt as never,
      {} as never,
    );
    // What the guard makes of a guest cookie: a guest identity, no login, no staff session.
    const req = {
      identity: { kind: 'guest', guestSessionId: 'g1', personId: 'p1', eventId: EVENT },
      staffSession: null,
      cookies: { mc_guest: 'guest-token' },
    } as unknown as FastifyRequest;

    await controller.follow(EVENT, { personId: PERSON }, req);

    expect(follows.followInEvent).toHaveBeenCalledWith(
      EVENT,
      PERSON,
      { guestSessionId: 'g1', guestEventId: EVENT },
      { userId: ANONYMOUS_USER_ID, staff: null },
    );
  });
});
