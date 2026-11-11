import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import {
  notifySparAgreed,
  notifySparCancelled,
  notifySparRequestReceived,
  type SparNoticeDeps,
} from './spar-notices';

const REQUEST = '3c1f0a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a02';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';

function deps(claimed: string | null = ACCOUNT, send = vi.fn(async () => undefined)) {
  const db = mockSupabase({
    global_persons: { rows: [{ id: JULIE, claimed_by_user_id: claimed }] },
  });
  const getAuthAdminUser = vi.fn(async () => ({
    ok: true,
    status: 200,
    data: { id: ACCOUNT, email: 'julie@example.test' },
  }));
  const logger = { warn: vi.fn(), error: vi.fn() };
  const d = {
    db: db.service,
    notifications: { sendImmediate: send },
    supabase: { getAuthAdminUser },
    logger,
  } as unknown as SparNoticeDeps;
  return { d, db, send, logger };
}

describe('the three FightBook notices', () => {
  it.each([
    [
      notifySparRequestReceived,
      'spar_request_received',
      '/me/fightbook?tab=inbox',
      'New spar request',
    ],
    [notifySparAgreed, 'spar_agreed', '/me/fightbook?tab=spars', 'Spar agreed'],
    [notifySparCancelled, 'spar_cancelled', '/me/fightbook?tab=spars', 'Spar cancelled'],
  ] as const)('%o goes to the account that holds the profile', async (notify, kind, url, title) => {
    const { d, db, send } = deps();
    await notify(d, REQUEST, JULIE);

    expect(selectsFor(db.from, 'global_persons')).toEqual(['claimed_by_user_id']);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind,
        entityId: REQUEST,
        userId: ACCOUNT,
        email: 'julie@example.test',
        url,
        preference: 'fightbook',
      }),
    );
    const [job] = send.mock.calls[0] as unknown as [{ title: string; body: string }];
    expect(job.title).toContain(title);
  });

  it('sends nothing for a profile no account holds, and says so', async () => {
    const { d, send, logger } = deps(null);
    await notifySparAgreed(d, REQUEST, JULIE);
    expect(send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(REQUEST));
  });

  it('logs a failed send instead of throwing: the change it reports is already saved', async () => {
    const { d, logger } = deps(
      ACCOUNT,
      vi.fn(async () => Promise.reject(new Error('redis down'))),
    );
    await expect(notifySparCancelled(d, REQUEST, JULIE)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('redis down'));
  });
});
