import { describe, expect, it, vi } from 'vitest';
import { EventsController } from './events.controller';

describe('EventsController auth', () => {
  it('creates events using internal GoTrue token validation from the admin cookie', async () => {
    const createEvent = vi.fn().mockResolvedValue({ id: 'event-1' });
    const getAuthUser = vi.fn().mockResolvedValue({ id: 'user-1' });
    const anonGetUser = vi.fn();
    const controller = new EventsController(
      { createEvent } as never,
      { getAuthUser, anon: { auth: { getUser: anonGetUser } } } as never,
      {} as never,
    );

    await controller.createEvent(
      '11111111-1111-4111-8111-111111111111',
      {
        name: 'FAL 2027',
        slug: 'fal-2027',
        startDate: '2027-03-14',
        endDate: '2027-03-14',
      },
      { cookies: { 'sb-access-token': 'cookie-token' }, headers: {} } as never,
    );

    expect(getAuthUser).toHaveBeenCalledWith('cookie-token');
    expect(anonGetUser).not.toHaveBeenCalled();
    expect(createEvent).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ slug: 'fal-2027' }),
      'user-1',
    );
  });
});
