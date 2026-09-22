import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { STAFF_COOKIE_NAME } from './staff.service';
import { filtersFor, scopedTo, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import {
  ACCOUNT,
  EVENT,
  LICE,
  OTHER_ACCOUNT,
  OTHER_EVENT,
  OTHER_LICE,
  PIN,
  accountRow,
  build,
  eventRow,
  liceRow,
  pinHash,
  signInQueue,
  withEvent,
} from './staff.service.login.fixtures';

/**
 * Staff sign-in — the door onto the scoring pad.
 *
 * Nothing executed `login`, `findEventBySlug` or `getAssignedLices` before this
 * file, so the filters deciding WHICH event a username is matched against were
 * load-bearing in nothing. As with the admin surface, these run service-role
 * and RLS is not underneath them.
 *
 * `event_staff_accounts` is a per-table QUEUE here: sign-in reads it, stamps it,
 * then reads it back for the `me` payload. So the account lookup's filters are
 * argument assertions in this file, and the cases that need the lookup itself
 * to decide seed the table instead, in staff.service.login.username.test.ts —
 * seeding works for both (the seeded row carries the read-back's embed), the
 * queue is simply what this file was written with. Every other read in the flow
 * is on a different table and is seeded, which is why the piste and bout cases
 * below assert outcomes.
 *
 * The rows and builders live in staff.service.login.fixtures.ts, shared with
 * that file.
 */

describe('StaffService.login', () => {
  it('matches the username within the caller event, case-folded and trimmed', async () => {
    const hash = await pinHash(PIN);
    const { service, supabase } = build({
      events: { rows: [eventRow(EVENT), eventRow(OTHER_EVENT)] },
      event_staff_accounts: signInQueue(accountRow(hash)),
      event_staff_lice_assignments: { rows: [] },
    });

    const result = await service.login({
      eventId: EVENT,
      username: '  MARIE  ',
      pin: PIN,
    } as never);

    expect(result.token).toBe('signed-token');
    // Argument assertions on the canned queue. Routed by table rather than by
    // call index — the account table is read three times in one sign-in, and an
    // index would silently follow the wrong one.
    expect(filtersFor(supabase.from, 'event_staff_accounts', 'eq')).toContainEqual([
      'event_id',
      EVENT,
    ]);
    expect(filtersFor(supabase.from, 'event_staff_accounts', 'eq')).toContainEqual([
      'username',
      'marie',
    ]);
  });

  it('stamps the sign-in against that account and no other', async () => {
    const hash = await pinHash(PIN);
    const { service, supabase } = build({
      events: { rows: [eventRow(EVENT)] },
      event_staff_accounts: signInQueue(accountRow(hash)),
      event_staff_lice_assignments: { rows: [] },
    });

    await service.login({ eventId: EVENT, username: 'marie', pin: PIN } as never);

    const [stamp] = writesTo(supabase, 'event_staff_accounts');
    expect(scopedTo(stamp, 'id')).toBe(ACCOUNT);
    expect(stamp?.row).toMatchObject({ last_login_at: expect.any(String) });
  });

  it('resolves the event by slug when the caller has no id', async () => {
    // Two events, and the slug is the only thing telling them apart. Lose it and
    // maybeSingle matches both, which is PGRST116 and no event at all.
    const hash = await pinHash(PIN);
    const { service, sign } = build({
      events: { rows: [eventRow(OTHER_EVENT), eventRow(EVENT)] },
      event_staff_accounts: signInQueue(accountRow(hash)),
      event_staff_lice_assignments: { rows: [] },
    });

    await service.login({
      eventSlugOrCode: `slug-${EVENT}`,
      username: 'marie',
      pin: PIN,
    } as never);

    // Read the resolved event off the SESSION, not off the `me` payload: `me`
    // comes from a canned read and would say `event-1` however the slug
    // resolved. The signed claim is the one thing downstream trusts.
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: EVENT }),
      expect.anything(),
    );
  });

  /**
   * The PIN bucket keys on the id when the body carries one (ruling 52), so
   * sign-in must resolve by the id too. Were that order to flip, a caller could
   * send the real slug with a fresh random uuid each time: the uuid would never
   * be read, and every attempt would be a new bucket.
   */
  it('resolves the event by the id, not the name sent beside it', async () => {
    const hash = await pinHash(PIN);
    const { service, sign } = build({
      events: { rows: [eventRow(OTHER_EVENT), eventRow(EVENT)] },
      event_staff_accounts: signInQueue(accountRow(hash)),
      event_staff_lice_assignments: { rows: [] },
    });

    await service.login({
      eventId: EVENT,
      eventSlugOrCode: `slug-${OTHER_EVENT}`,
      username: 'marie',
      pin: PIN,
    } as never);

    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: EVENT }),
      expect.anything(),
    );
  });

  it('refuses a PIN that does not verify', async () => {
    const hash = await pinHash(PIN);
    const { service } = build({
      events: { rows: [eventRow(EVENT)] },
      event_staff_accounts: signInQueue(accountRow(hash)),
      event_staff_lice_assignments: { rows: [] },
    });

    await expect(
      service.login({ eventId: EVENT, username: 'marie', pin: '999999' } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an event that is no longer open for scoring', async () => {
    const { service } = build({
      events: { rows: [eventRow(EVENT, { status: 'completed' })] },
      event_staff_accounts: [{ data: null, error: null }],
      event_staff_lice_assignments: { rows: [] },
    });

    await expect(
      service.login({ eventId: EVENT, username: 'marie', pin: PIN } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('StaffService sign-in payload — assigned pistes', () => {
  async function signIn(tables: Record<string, unknown>) {
    const hash = await pinHash(PIN);
    const { service } = build({
      events: { rows: [eventRow(EVENT)] },
      event_staff_accounts: signInQueue(accountRow(hash)),
      ...tables,
    });
    return (await service.login({ eventId: EVENT, username: 'marie', pin: PIN } as never)) as {
      me: { lices: Array<{ id: string; currentMatch: { id: string; status: string } | null }> };
    };
  }

  it('returns the pistes assigned to that account only', async () => {
    const result = await signIn({
      event_staff_lice_assignments: {
        rows: [
          { staff_account_id: ACCOUNT, lice_id: LICE, lices: { id: LICE, name: 'Piste 1' } },
          {
            staff_account_id: OTHER_ACCOUNT,
            lice_id: OTHER_LICE,
            lices: { id: OTHER_LICE, name: 'Piste 2' },
          },
        ],
      },
      lices: { rows: [liceRow(LICE), liceRow(OTHER_LICE)] },
      matches: { rows: [] },
    });

    expect(result.me.lices.map((l) => l.id)).toEqual([LICE]);
  });

  it('reports the bout on that piste rather than one on a neighbour', async () => {
    // The neighbour's bout is scheduled EARLIER, so it sorts ahead. Without the
    // lice filter it is the one picked, which is how a scorer ends up looking at
    // someone else's piste.
    const result = await signIn({
      event_staff_lice_assignments: {
        rows: [{ staff_account_id: ACCOUNT, lice_id: LICE, lices: { id: LICE, name: 'Piste 1' } }],
      },
      lices: { rows: [liceRow(LICE), liceRow(OTHER_LICE)] },
      matches: {
        rows: [
          {
            id: 'match-neighbour',
            lice_id: OTHER_LICE,
            status: 'running',
            scheduled_at: '2026-08-08T08:00:00Z',
          },
          {
            id: 'match-here',
            lice_id: LICE,
            status: 'running',
            scheduled_at: '2026-08-08T09:00:00Z',
          },
        ],
      },
    });

    expect(result.me.lices[0]?.currentMatch?.id).toBe('match-here');
  });

  it('reads the piste row the assignment names, not the first one seeded', async () => {
    // `getCurrentForLiceId` resolves the piste through maybeSingle, which hands
    // back the first surviving row rather than erroring — so losing the id
    // filter labels the scorer's piste with a neighbour's event.
    const result = (await signIn({
      event_staff_lice_assignments: {
        rows: [{ staff_account_id: ACCOUNT, lice_id: LICE, lices: { id: LICE, name: 'Piste 1' } }],
      },
      lices: { rows: [liceRow(OTHER_LICE, OTHER_EVENT), liceRow(LICE)] },
      matches: { rows: [] },
    })) as unknown as { me: { lices: Array<{ event: { id: string } }> } };

    expect(result.me.lices[0]?.event.id).toBe(EVENT);
  });

  it('ignores a finished bout when reporting what is on the piste', async () => {
    // `completed` is outside the status window. Without it the finished bout is
    // a candidate, and it sorts ahead of the scheduled one.
    const result = await signIn({
      event_staff_lice_assignments: {
        rows: [{ staff_account_id: ACCOUNT, lice_id: LICE, lices: { id: LICE, name: 'Piste 1' } }],
      },
      lices: { rows: [liceRow(LICE)] },
      matches: {
        rows: [
          {
            id: 'match-done',
            lice_id: LICE,
            status: 'completed',
            scheduled_at: '2026-08-08T08:00:00Z',
          },
          {
            id: 'match-next',
            lice_id: LICE,
            status: 'scheduled',
            scheduled_at: '2026-08-08T09:00:00Z',
          },
        ],
      },
    });

    expect(result.me.lices[0]?.currentMatch?.id).toBe('match-next');
  });
});

/**
 * `/staff-auth/me` — the payload the pad re-reads on every launch, and the only
 * way the staff app learns its own role.
 *
 * It reads `event_staff_accounts` TWICE: once to resolve the session, scoped by
 * event AND id, then again for the payload itself, scoped by id ALONE. That
 * second filter is what this describe exists for. Sign-in reaches the same
 * method, but behind the canned queue above, where it decides nothing — so the
 * fixture here seeds the table instead and lets both reads narrow it.
 */
describe('StaffService.getMe', () => {
  const request = () =>
    ({ cookies: { [STAFF_COOKIE_NAME]: 'token' }, headers: {} }) as unknown as FastifyRequest;
  const verify = () => ({ sub: ACCOUNT, event_id: EVENT, type: 'staff' });

  /**
   * A colleague on the same event. The payload read filters on id alone and ends
   * in `maybeSingle`, so losing that filter matches both of us — PGRST116, and a
   * payload built from nobody. They differ in both the things it is read for, so
   * a fixture that did resolve one of us would still be caught.
   */
  const ME_ROWS = [
    withEvent(
      accountRow('x', { id: OTHER_ACCOUNT, display_name: 'Someone Else', role: 'checkin' }),
    ),
    withEvent(accountRow('x')),
  ];

  it('answers for the account named in the cookie, not merely one in the event', async () => {
    const { service } = build(
      {
        event_staff_accounts: { rows: ME_ROWS },
        events: { rows: [eventRow(EVENT)] },
        event_staff_lice_assignments: { rows: [] },
      },
      { verify },
    );

    const me = (await service.getMe(request())) as {
      type: string;
      account: { id: string; display_name: string; role: string };
      lices: unknown[];
    };

    expect(me.type).toBe('staff');
    expect(me.account.id).toBe(ACCOUNT);
    expect(me.account.display_name).toBe('Marie Dubois');
    // The role travels on this payload because the token carries none (0173):
    // the landing route after sign-in and every role-specific nav item read it
    // from here, so serving a colleague's row would re-role the tablet.
    expect(me.account.role).toBe('scoring');
    // An unassigned scoring account still gets the key, just no pistes.
    expect(me.lices).toEqual([]);
  });

  it('never asks for the PIN hash on the payload read', async () => {
    // The double ignores projections, so no value assertion can catch a
    // pin_hash that creeps into this SELECT — and this payload is handed
    // straight to the tablet.
    const { service, supabase } = build(
      {
        event_staff_accounts: { rows: ME_ROWS },
        events: { rows: [eventRow(EVENT)] },
        event_staff_lice_assignments: { rows: [] },
      },
      { verify },
    );

    await service.getMe(request());

    expect(selectsFor(supabase.from, 'event_staff_accounts').at(-1)).not.toMatch(/pin_hash/);
  });
});
