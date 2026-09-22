import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { writesTo } from '../../common/testing/supabase-chain';
import {
  ACCOUNT,
  EVENT,
  OTHER_ACCOUNT,
  PIN,
  accountRow,
  build,
  eventRow,
  pinHash,
  withEvent,
} from './staff.service.login.fixtures';

/**
 * Ruling 48: the username is compared exactly. The lookup was an `ilike`, where
 * `_` is any one character and `%` any run, so `mari_` reached `marie` — and the
 * PIN throttle, keyed on the typed name, gave each spelling of it fresh tries.
 *
 * Seeded rather than queued, so the lookup's own filters decide the result —
 * staff.service.login.test.ts keeps the queue it was written with, which says
 * nothing about what a lookup would find. `withEvent` carries the embed the
 * `me` read-back selects.
 */
describe('StaffService.login — the username is compared exactly', () => {
  const seededAccount = (hash: string, over: Record<string, unknown> = {}) =>
    withEvent(accountRow(hash, over));

  it.each([
    ['_', 'mari_'],
    ['%', 'ma%'],
  ])('refuses a name that `%s` matches as a wildcard, and signs nobody in', async (_w, typed) => {
    const hash = await pinHash(PIN);
    const { service, supabase } = build({
      events: { rows: [eventRow(EVENT)] },
      event_staff_accounts: { rows: [seededAccount(hash)] },
      event_staff_lice_assignments: { rows: [] },
    });

    const outcome = await service
      .login({ eventId: EVENT, username: typed, pin: PIN } as never)
      .then(
        () => 'signed in',
        (error: unknown) => error,
      );

    // No sign-in stamp: the account was never reached.
    expect(writesTo(supabase, 'event_staff_accounts')).toEqual([]);
    expect(outcome).toBeInstanceOf(UnauthorizedException);
  });

  it('signs `table_1` in when `table.1` is on the same event', async () => {
    const { service, sign } = build({
      events: { rows: [eventRow(EVENT)] },
      event_staff_accounts: {
        rows: [
          seededAccount(await pinHash('135790'), { id: OTHER_ACCOUNT, username: 'table.1' }),
          seededAccount(await pinHash(PIN), { username: 'table_1' }),
        ],
      },
      event_staff_lice_assignments: { rows: [] },
    });

    await service.login({ eventId: EVENT, username: ' Table_1 ', pin: PIN } as never);

    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: ACCOUNT, event_id: EVENT }),
      expect.anything(),
    );
  });
});
