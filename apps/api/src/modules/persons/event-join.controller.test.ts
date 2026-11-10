import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BLOCK_ON_COMPLETED_EVENT_KEY } from '../../common/event-readonly/block-on-completed.decorator';
import { EventJoinController } from './event-join.controller';

const req = { cookies: {}, headers: {} } as never;

describe('EventJoinController — POST me/events/:eventId/join', () => {
  it('refuses a caller with no account (a guest session is none) before the handler reads anything', async () => {
    const auth = {
      requireAccount: vi
        .fn()
        .mockRejectedValue(new UnauthorizedException('Authentication required')),
    };
    const joins = { join: vi.fn() };
    const ctl = new EventJoinController(auth as never, joins as never);
    await expect(ctl.join('ev-1', {}, req)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(joins.join).not.toHaveBeenCalled();
  });

  it("joins as the request's account, with the typed names", async () => {
    const account = { id: 'user-bob', email: 'bob@mail.fr' };
    const auth = { requireAccount: vi.fn().mockResolvedValue(account) };
    const joins = { join: vi.fn().mockResolvedValue({ personId: 'p-1', joined: 'new' }) };
    const ctl = new EventJoinController(auth as never, joins as never);
    const names = { givenName: 'Bob', familyName: 'Martin' };
    await expect(ctl.join('ev-1', names, req)).resolves.toEqual({ personId: 'p-1', joined: 'new' });
    expect(joins.join).toHaveBeenCalledWith('ev-1', account, expect.any(Object), names);
  });

  it('is closed on a completed Event (573), by the read-only guard', () => {
    expect(
      Reflect.getMetadata(BLOCK_ON_COMPLETED_EVENT_KEY, EventJoinController.prototype.join),
    ).toBe(true);
  });
});
