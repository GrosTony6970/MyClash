/**
 * The own addresses of many accounts, in one call (operator ruling 215).
 *
 * The senders hold what they do with the answer (`new-event-notice.test.ts`). This holds the
 * reader itself: one call whatever the number of accounts, no call for nobody, and a failure that
 * is logged and answers no address.
 */
import { describe, expect, it, vi } from 'vitest';
import { lastFunctionParams } from '../../common/testing/migration-function';
import { accountEmails } from './account-emails';

function build(answer: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => answer);
  const warn = vi.fn();
  const read = (ids: string[]) =>
    accountEmails({ supabase: { service: { rpc } } as never, logger: { warn } }, ids, 'A notice');
  return { rpc, warn, read };
}

describe('the addresses of many accounts', () => {
  it('asks the database function once, with every id, by the name of its argument', async () => {
    const { rpc, read } = build({ data: [], error: null });
    const ids = Array.from({ length: 1200 }, (_, at) => `u-${at}`);

    await read(ids);

    expect(rpc.mock.calls).toEqual([['account_emails', { p_user_ids: ids }]]);
    expect(Object.keys(rpc.mock.calls[0]![1])).toEqual(lastFunctionParams('account_emails'));
  });

  it('answers the address of each account that has one', async () => {
    const { read } = build({
      data: [
        { user_id: 'u-marc', email: 'marc@example.com' },
        // The function leaves these out; a row without an address is no address all the same.
        { user_id: 'u-zoe', email: null },
        { user_id: 'u-paul', email: 'paul@example.com' },
      ],
      error: null,
    });

    expect([...(await read(['u-paul', 'u-zoe', 'u-marc', 'u-gone']))]).toEqual([
      ['u-marc', 'marc@example.com'],
      ['u-paul', 'paul@example.com'],
    ]);
  });

  it('asks nothing for nobody', async () => {
    const { rpc, read } = build({ data: [], error: null });

    expect((await read([])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('logs a read that fails, and answers no address', async () => {
    const { warn, read } = build({ data: null, error: { message: 'permission denied' } });

    expect((await read(['u-paul'])).size).toBe(0);
    expect(warn.mock.calls).toEqual([
      ['A notice: account addresses unreadable: permission denied'],
    ]);
  });
});
