import { describe, expect, it, vi } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import {
  notifySparAgreed,
  notifySparCallAnswered,
  notifySparCallPicked,
  notifySparCancelled,
  notifySparMarkedDone,
  notifySparRequestReceived,
  type SparNoticeDeps,
} from './spar-notices';

const REQUEST = '3c1f0a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a02';
const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a03';
const CALL = '4d2f0a52-7d59-4a57-9f55-1b1f3f5c2a04';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';

function deps(
  claimed: string | null = ACCOUNT,
  send = vi.fn(async () => undefined),
  blocks: Array<Record<string, string>> = [],
) {
  const db = mockSupabase({
    global_persons: { rows: [{ id: JULIE, claimed_by_user_id: claimed }] },
    fightbook_blocks: { rows: blocks },
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
    [notifySparMarkedDone, 'spar_marked_done', '/me/fightbook?tab=spars', 'marked as done'],
    [notifySparCallPicked, 'spar_call_picked', '/me/fightbook?tab=spars', 'You were picked'],
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

describe('"Someone is in", to the poster of an open call (Decision 15)', () => {
  const block = (blocker: string, blocked: string) => ({
    blocker_global_person_id: blocker,
    blocked_global_person_id: blocked,
  });

  it('goes to the account that holds the poster, about the call, to Find', async () => {
    const { d, db, send } = deps();
    await notifySparCallAnswered(d, CALL, JULIE, MARC);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'spar_call_answered',
        entityId: CALL,
        userId: ACCOUNT,
        url: '/me/fightbook?tab=find',
        preference: 'fightbook',
      }),
    );
    const [job] = send.mock.calls[0] as unknown as [{ title: string }];
    expect(job.title).toContain('Someone is in for your open call');
    // The poster's blocks only, naming the answerer: one row, never a list of hers.
    expect(selectsFor(db.from, 'fightbook_blocks')).toEqual(['id']);
    expect(filtersFor(db.from, 'fightbook_blocks', 'eq')).toEqual([
      ['blocker_global_person_id', JULIE],
      ['blocked_global_person_id', MARC],
    ]);
  });

  it('is not sent when the poster blocked the answerer', async () => {
    const { d, send } = deps(ACCOUNT, undefined, [block(JULIE, MARC)]);
    await notifySparCallAnswered(d, CALL, JULIE, MARC);
    expect(send).not.toHaveBeenCalled();
  });

  it('is sent when it is the answerer who blocked the poster, or another pair', async () => {
    const { d, send } = deps(ACCOUNT, undefined, [block(MARC, JULIE), block(JULIE, REQUEST)]);
    await notifySparCallAnswered(d, CALL, JULIE, MARC);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('logs an unreadable block instead of throwing, and sends nothing', async () => {
    const db = mockSupabase({
      fightbook_blocks: { data: null, error: { message: 'blocks down' } },
    });
    const send = vi.fn(async () => undefined);
    const logger = { warn: vi.fn(), error: vi.fn() };
    const d = {
      db: db.service,
      notifications: { sendImmediate: send },
      supabase: { getAuthAdminUser: vi.fn() },
      logger,
    } as unknown as SparNoticeDeps;
    await expect(notifySparCallAnswered(d, CALL, JULIE, MARC)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('blocks down'));
  });
});
