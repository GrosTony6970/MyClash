/**
 * "Is this browser's alert address saved for ME?" (operator ruling 238). Anna turned phone alerts
 * on at the club's laptop. Ben signs in on it: the browser still holds Anna's address, and the
 * settings page said "Enabled" to Ben because it asked the browser alone. The page, and the check
 * a personal space runs at each visit, now ask the server, which answers for the caller only.
 */
import { describe, expect, it } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { NotificationsService } from './notifications.service';

const ANNA = 'u-anna';
const BEN = 'u-ben';
const LAPTOP = 'https://push.example/laptop';
const rows = [
  { id: 'sub-1', user_id: ANNA, endpoint: LAPTOP },
  { id: 'sub-2', user_id: BEN, endpoint: 'https://push.example/ben-phone' },
];

function setup(seed: Parameters<typeof mockSupabase>[0] = { push_subscriptions: { rows } }) {
  const db = mockSupabase(seed);
  return { db, service: new NotificationsService(db as never, { get: () => 'key' } as never) };
}

describe('is this address saved for the caller', () => {
  it('yes for the account that saved it', async () => {
    await expect(setup().service.isSubscribed(ANNA, LAPTOP)).resolves.toEqual({ subscribed: true });
  });

  it("no for another account: the address is somebody else's", async () => {
    await expect(setup().service.isSubscribed(BEN, LAPTOP)).resolves.toEqual({ subscribed: false });
  });

  it('no for an address nobody saved', async () => {
    const { service } = setup();
    await expect(service.isSubscribed(ANNA, 'https://push.example/gone')).resolves.toEqual({
      subscribed: false,
    });
  });

  it('asks by the account and the address', async () => {
    const { db, service } = setup();
    await service.isSubscribed(BEN, LAPTOP);

    expect(selectsFor(db.from, 'push_subscriptions')).toEqual(['id']);
    expect(filtersFor(db.from, 'push_subscriptions', 'eq')).toEqual([
      ['user_id', BEN],
      ['endpoint', LAPTOP],
    ]);
  });

  it('a failed read is an error, not "not yours": the browser would drop a good address', async () => {
    const { service } = setup({ push_subscriptions: { error: { message: 'boom' } } });
    const asked = service.isSubscribed(ANNA, LAPTOP);

    await expect(asked).rejects.toThrow('Push subscription read failed: boom');
    await expect(asked).rejects.not.toHaveProperty('status');
  });
});
