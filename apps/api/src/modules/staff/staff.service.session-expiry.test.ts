import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@nestjs/common';
import { selectsFor } from '../../common/testing/supabase-chain';
import {
  EVENT,
  PIN,
  accountRow,
  build,
  eventRow,
  pinHash,
  signInQueue,
} from './staff.service.login.fixtures';

/**
 * A tablet's sign-in lasts until the Event closes: 06:00 after its last day, on
 * the Event's own clock (rulings 154, 155). It used to end at 23:59 UTC on the
 * last day, which is 19:59 in New York.
 */
async function signIn(event: Record<string, unknown>, by: 'id' | 'slug' = 'id') {
  const hash = await pinHash(PIN);
  const built = build({
    events: { rows: [eventRow(EVENT, event)] },
    event_staff_accounts: signInQueue(accountRow(hash)),
    event_staff_lice_assignments: { rows: [] },
  });
  const logger = (built.service as unknown as { logger: Logger }).logger;
  const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  const login =
    by === 'id'
      ? { eventId: EVENT, username: 'marie', pin: PIN }
      : { eventSlugOrCode: `slug-${EVENT}`, username: 'marie', pin: PIN };
  const { expiresAt } = await built.service.login(login as never);
  const signedExpiry = (built.sign.mock.calls[0] as unknown[])[1];
  return { ...built, warn, expiresAt, signedExpiry };
}

const warned = (warn: { mock: { calls: unknown[][] } }): string[] =>
  warn.mock.calls.map(([message]) => String(message));

describe('StaffService.login: the sign-in expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each<'id' | 'slug'>(['id', 'slug'])(
    'lasts until 06:00 New York time after the last day (Event found by %s)',
    async (by) => {
      vi.setSystemTime(new Date('2026-11-07T14:00:00Z'));
      const { expiresAt, signedExpiry, supabase, warn } = await signIn(
        { start_date: '2026-11-06', end_date: '2026-11-07', timezone: 'America/New_York' },
        by,
      );

      expect(expiresAt).toEqual(new Date('2026-11-08T11:00:00.000Z'));
      expect(signedExpiry).toEqual(expiresAt);
      expect(selectsFor(supabase.from, 'events')[0]).toContain('timezone');
      expect(warned(warn)).toEqual([]);
    },
  );

  it('lasts until 06:00 Paris time after the last day', async () => {
    vi.setSystemTime(new Date('2026-07-12T14:00:00Z'));
    const { expiresAt } = await signIn({
      start_date: '2026-07-11',
      end_date: '2026-07-12',
      timezone: 'Europe/Paris',
    });

    expect(expiresAt).toEqual(new Date('2026-07-13T04:00:00.000Z'));
  });

  it('reads an unknown zone as Europe/Paris and says so', async () => {
    vi.setSystemTime(new Date('2026-07-12T14:00:00Z'));
    const { expiresAt, warn } = await signIn({
      start_date: '2026-07-11',
      end_date: '2026-07-12',
      timezone: 'Mars/Olympus',
    });

    expect(expiresAt).toEqual(new Date('2026-07-13T04:00:00.000Z'));
    expect(warned(warn)).toEqual([expect.stringContaining('"Mars/Olympus"')]);
    expect(warned(warn)[0]).toContain(EVENT);
  });

  it('lasts 12 hours, and says so, when the last day cannot be read', async () => {
    vi.setSystemTime(new Date('2026-07-12T14:00:00Z'));
    const { expiresAt, warn } = await signIn({
      start_date: '2026-07-11',
      end_date: null,
      timezone: 'Europe/Paris',
    });

    expect(expiresAt).toEqual(new Date('2026-07-13T02:00:00.000Z'));
    expect(warned(warn)).toEqual([expect.stringContaining(EVENT)]);
  });

  it('lasts 12 hours when signing in after the Event closed', async () => {
    // 07:00 Paris on the morning after: the close has passed, the ticker has not run yet.
    vi.setSystemTime(new Date('2026-07-13T05:00:00Z'));
    const { expiresAt } = await signIn({
      start_date: '2026-07-11',
      end_date: '2026-07-12',
      timezone: 'Europe/Paris',
    });

    expect(expiresAt).toEqual(new Date('2026-07-13T17:00:00.000Z'));
  });
});
