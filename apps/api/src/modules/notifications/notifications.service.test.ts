import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
    then: vi.fn((resolve, reject) => Promise.resolve(result).then(resolve, reject)),
  };
  chain.select.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

describe('NotificationsService', () => {
  it('returns configured VAPID public key', () => {
    const service = new NotificationsService(
      { service: { from: vi.fn() } } as never,
      {
        get: (key: string) => (key === 'VAPID_PUBLIC_KEY' ? 'public-key' : undefined),
      } as never,
    );

    expect(service.getVapidPublicKey()).toEqual({ publicKey: 'public-key' });
  });

  it('throws when VAPID public key is missing', () => {
    const service = new NotificationsService(
      { service: { from: vi.fn() } } as never,
      {
        get: () => undefined,
      } as never,
    );

    expect(() => service.getVapidPublicKey()).toThrow(BadRequestException);
  });

  it('stores a push subscription for the authenticated user', async () => {
    const deleteChain = makeChain({ data: null, error: null });
    const insertChain = makeChain({
      data: { id: 'sub-1', endpoint: 'https://push.example/1' },
      error: null,
    });
    const from = vi.fn().mockReturnValueOnce(deleteChain).mockReturnValueOnce(insertChain);
    const service = new NotificationsService(
      { service: { from } } as never,
      {
        get: () => 'public-key',
      } as never,
    );

    await expect(
      service.subscribe(
        'user-1',
        {
          endpoint: 'https://push.example/1',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        },
        'Mozilla/5.0',
      ),
    ).resolves.toEqual({ id: 'sub-1', endpoint: 'https://push.example/1' });

    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(deleteChain.eq).toHaveBeenCalledWith('endpoint', 'https://push.example/1');
    expect(insertChain.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      endpoint: 'https://push.example/1',
      p256dh_key: 'p256dh-key',
      auth_key: 'auth-key',
      user_agent: 'Mozilla/5.0',
      last_seen_at: expect.any(String),
    });
  });

  it('deletes only the authenticated user subscription', async () => {
    const deleteChain = makeChain({ data: null, error: null });
    const from = vi.fn().mockReturnValue(deleteChain);
    const service = new NotificationsService(
      { service: { from } } as never,
      {
        get: () => 'public-key',
      } as never,
    );

    await expect(service.unsubscribe('user-1', 'sub-1')).resolves.toEqual({ deleted: true });

    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith('id', 'sub-1');
    expect(deleteChain.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });
});
