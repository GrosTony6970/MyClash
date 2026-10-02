/**
 * The notice of a new Event: its words, and the address its email goes to.
 *
 * The words (ruling 202). Paul follows Lyon HEMA, and Lyon HEMA publishes the Open de Lyon. The
 * title is the organisation's name and the body the Event's, its date and its city: names, said
 * once. The email subject is a sentence, so it comes in both languages.
 *
 * The address (ruling 215). The notice took the address of the follower's first roster row, so
 * Marc, who follows the club and is on no roster, got no email. It goes to the account's own
 * address, read for every follower in ONE call (`account_emails`, migration 0217): the fan-out is
 * up to 5,000 followers.
 */
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lastFunctionParams } from '../../../common/testing/migration-function';
import {
  mockSupabase,
  queriedTables,
  type SupabaseRow,
  type TableSeed,
} from '../../../common/testing/supabase-chain';
import { NotificationEventsService } from './notification-events.service';

const OPEN = 'e-open';
const LYON_HEMA = 'o-lyon';

const following = (userId: string, organization = LYON_HEMA, notify = true) => ({
  follower_user_id: userId,
  followed_organization_id: organization,
  notify_new_event: notify,
});

/** No roster table at all: a read of it would throw. The address is the account's. */
function tables(
  organizations: SupabaseRow[],
  follows: SupabaseRow[] = [following('u-paul')],
): Record<string, TableSeed> {
  return {
    events: {
      rows: [
        {
          id: OPEN,
          name: 'Open de Lyon',
          slug: 'open-de-lyon',
          city: 'Lyon',
          start_date: '2026-10-03',
          event_kind: 'standard',
          organization_id: LYON_HEMA,
        },
      ],
    },
    organizations: { rows: organizations },
    organization_follows: { rows: follows },
  };
}

const LYON = [{ id: LYON_HEMA, name: 'Lyon HEMA' }];
const account = (userId: string, email: string) => ({ user_id: userId, email });

const scheduler = { sendImmediateBulk: vi.fn() };
const rpc = vi.fn();

/** Lyon HEMA publishes the Open; the notices queued. */
async function announced(seed: Record<string, TableSeed>) {
  const db = mockSupabase(seed);
  await new NotificationEventsService(
    { service: { from: db.from, rpc } } as never,
    scheduler as never,
  ).organizerPublishedEvent(OPEN);
  const notices = scheduler.sendImmediateBulk.mock.calls[0]?.[0] as
    Array<{ userId: string; email: string | null }> | undefined;
  return { db, notices };
}

const addresses = (notices: Array<{ userId: string; email: string | null }> | undefined) =>
  (notices ?? []).map((notice) => [notice.userId, notice.email]);

beforeEach(() => {
  scheduler.sendImmediateBulk.mockReset();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [account('u-paul', 'paul@example.com')], error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the notice of a new Event', () => {
  it('names the organisation and the Event once, and says the subject twice', async () => {
    expect((await announced(tables(LYON))).notices).toEqual([
      {
        kind: 'organizer_published_event',
        entityId: OPEN,
        userId: 'u-paul',
        title: 'Lyon HEMA',
        body: 'Open de Lyon — 2026-10-03 · Lyon',
        url: '/e/open-de-lyon/home',
        email: 'paul@example.com',
        emailSubject: 'Lyon HEMA a publié Open de Lyon / Lyon HEMA published Open de Lyon',
        preference: 'organizer_updates',
      },
    ]);
  });

  it('calls an organisation it cannot read "an organiser", in each language', async () => {
    expect((await announced(tables([]))).notices).toMatchObject([
      {
        title: 'Un organisateur / An organiser',
        emailSubject: 'Un organisateur a publié Open de Lyon / An organiser published Open de Lyon',
      },
    ]);
  });
});

describe("the notice is mailed to the account's own address (ruling 215)", () => {
  const FOLLOWERS = [
    following('u-paul'),
    // He follows another club: he is not told, and his address is not asked for.
    following('u-tom', 'o-paris'),
    following('u-marc'),
    // She switched this notice off.
    following('u-nina', LYON_HEMA, false),
    following('u-zoe'),
  ];

  it('reads the address of every follower in one call, and no roster', async () => {
    rpc.mockResolvedValue({
      data: [account('u-marc', 'marc@example.com'), account('u-paul', 'paul@example.com')],
      error: null,
    });

    const { db, notices } = await announced(tables(LYON, FOLLOWERS));

    expect(rpc.mock.calls).toEqual([
      ['account_emails', { p_user_ids: ['u-paul', 'u-marc', 'u-zoe'] }],
    ]);
    expect(queriedTables(db.from)).toEqual(['events', 'organizations', 'organization_follows']);
    // Zoé's account has no address: her notice goes to her phone only.
    expect(addresses(notices)).toEqual([
      ['u-paul', 'paul@example.com'],
      ['u-marc', 'marc@example.com'],
      ['u-zoe', null],
    ]);
  });

  it('names the argument as the database function does', async () => {
    await announced(tables(LYON));

    expect(Object.keys(rpc.mock.calls[0]![1] as object)).toEqual(
      lastFunctionParams('account_emails'),
    );
  });

  it('sends the notice all the same when the addresses cannot be read, and says so', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

    const { notices } = await announced(tables(LYON, FOLLOWERS));

    expect(addresses(notices)).toEqual([
      ['u-paul', null],
      ['u-marc', null],
      ['u-zoe', null],
    ]);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      `New-Event notice of ${OPEN}: account addresses unreadable: permission denied`,
    ]);
  });

  it('asks for no address when nobody follows the organisation', async () => {
    const { notices } = await announced(tables(LYON, [following('u-tom', 'o-paris')]));

    expect(notices).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});
