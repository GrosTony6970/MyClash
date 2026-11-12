import { describe, expect, it, vi } from 'vitest';
import { lastFunctionParams } from '../../common/testing/migration-function';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { notifySparFlagRaised } from './spar-flag-notice';

const FLAG = '3c1f0a52-7d59-4a57-9f55-1b1f3f5c2a01';
const CLUB_ADMIN = '9a8b7c6d-1111-4222-8333-944455566677';
const SUPER_ADMIN = '9a8b7c6d-2222-4222-8333-944455566677';

type Row = { user_id: string; audience: 'club' | 'platform'; org_slug: string | null };

function deps(rows: Row[] | null, error: { message: string } | null = null) {
  const db = mockSupabase({}, { fightbook_flag_recipients: () => ({ data: rows, error }) });
  const send = vi.fn(async () => undefined);
  const getAuthAdminUser = vi.fn(async (id: string) => ({
    ok: true,
    status: 200,
    data: { id, email: `${id.slice(0, 4)}@example.test` },
  }));
  const logger = { warn: vi.fn(), error: vi.fn() };
  const d = {
    db: db.service,
    notifications: { sendImmediate: send },
    supabase: { getAuthAdminUser },
    logger,
    domain: 'example.test',
  } as never;
  return { d, db, send, logger };
}

describe('the safety flag alert', () => {
  it('asks for the admins and owners, with the keys the function is defined with', async () => {
    const { d, db } = deps([]);
    await notifySparFlagRaised(d, FLAG);

    expect(db.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = db.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('fightbook_flag_recipients');
    expect(Object.keys(args).sort()).toEqual([...lastFunctionParams(name)].sort());
    expect(args).toEqual({ p_flag: FLAG, p_roles: ['admin', 'owner'] });
  });

  it('sends one notice per recipient, to the right page, with no name, no reason, no switch', async () => {
    const { d, send } = deps([
      { user_id: CLUB_ADMIN, audience: 'club', org_slug: 'club-slug' },
      { user_id: SUPER_ADMIN, audience: 'platform', org_slug: null },
    ]);
    await notifySparFlagRaised(d, FLAG);

    expect(send).toHaveBeenCalledTimes(2);
    const jobs = send.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(jobs[0]![0]).toMatchObject({
      kind: 'spar_flag_raised',
      entityId: FLAG,
      userId: CLUB_ADMIN,
      email: '9a8b@example.test',
      url: 'https://admin.example.test/org/club-slug/fightbook-flags',
      title: 'Un signalement de sécurité à examiner / A safety report needs a look',
    });
    expect(jobs[1]![0]).toMatchObject({
      userId: SUPER_ADMIN,
      url: 'https://admin.example.test/admin/fightbook-flags',
    });
    for (const [job] of jobs) {
      expect(job).not.toHaveProperty('preference');
      // The fixed text only: nothing of the flag (a name, a reason) is read into it.
      expect(job.body).toBe(
        'Un combattant a signalé un problème de sécurité sur un spar. / A fighter reported a safety problem on a spar.',
      );
    }
  });

  it('a failed read logs the flag id and resolves', async () => {
    const { d, send, logger } = deps(null, { message: 'boom' });
    await expect(notifySparFlagRaised(d, FLAG)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(FLAG));
  });

  it('a failed send logs the flag id, resolves, and the next recipient still gets it', async () => {
    const { d, send, logger } = deps([
      { user_id: CLUB_ADMIN, audience: 'club', org_slug: 'club-slug' },
      { user_id: SUPER_ADMIN, audience: 'platform', org_slug: null },
    ]);
    send.mockRejectedValueOnce(new Error('redis down'));
    await expect(notifySparFlagRaised(d, FLAG)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(FLAG));
  });

  it('a club recipient with no slug is logged and sends nothing to a wrong page', async () => {
    const { d, send, logger } = deps([{ user_id: CLUB_ADMIN, audience: 'club', org_slug: null }]);
    await notifySparFlagRaised(d, FLAG);
    expect(send).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(FLAG));
  });
});
