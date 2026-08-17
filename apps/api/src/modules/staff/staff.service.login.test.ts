import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';

const scrypt = promisify(scryptCallback);

/**
 * Staff sign-in — the door onto the scoring pad.
 *
 * Nothing executed `login`, `findEventBySlug` or `getAssignedLices` before this
 * file, so the filters deciding WHICH event a username is matched against were
 * load-bearing in nothing. As with the admin surface, these run service-role
 * and RLS is not underneath them.
 *
 * One shape constraint drives the fixtures here. The account lookup is
 * `.eq('event_id', …).ilike('username', …)`, and the double refuses `ilike` on a
 * seeded table rather than silently returning every row — so that ONE query has
 * to stay canned, and its two filters can only be argument assertions. Every
 * other read in the flow is on a different table and is seeded, which is why the
 * piste and bout cases below assert outcomes instead.
 *
 * `event_staff_accounts` is a per-table QUEUE: sign-in reads it, stamps it, then
 * reads it back for the `me` payload, and those three want different answers.
 */

const ORG = 'org-1';
const EVENT = 'event-1';
const OTHER_EVENT = 'event-2';
const ACCOUNT = 'staff-1';
const OTHER_ACCOUNT = 'staff-2';
const LICE = 'lice-1';
const OTHER_LICE = 'lice-2';

const PIN = '246810';

/** The stored format `verifyPin` expects: `scrypt:<salt b64>:<key b64>`. */
async function pinHash(pin: string) {
  const salt = randomBytes(16);
  const key = (await scrypt(pin, salt, 32)) as Buffer;
  return `scrypt:${salt.toString('base64')}:${key.toString('base64')}`;
}

const eventRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  organization_id: ORG,
  slug: `slug-${id}`,
  name: `Event ${id}`,
  status: 'running',
  start_date: '2026-08-08',
  end_date: '2099-12-31',
  ...over,
});

const accountRow = (hash: string, over: Record<string, unknown> = {}) => ({
  id: ACCOUNT,
  event_id: EVENT,
  display_name: 'Marie Dubois',
  username: 'marie',
  pin_hash: hash,
  status: 'active',
  role: 'scoring',
  ...over,
});

const liceRow = (id: string, eventId = EVENT) => ({
  id,
  name: `Piste ${id}`,
  event_id: eventId,
  events: { id: eventId, slug: `slug-${eventId}`, name: `Event ${eventId}`, status: 'running' },
});

function build(tables: Record<string, unknown>) {
  const supabase = mockSupabase(tables as never);
  const sign = vi.fn(() => 'signed-token');
  const service = new StaffService(supabase as never, {} as never, { sign } as never, {} as never);
  return { service, supabase, sign };
}

/**
 * The three `event_staff_accounts` answers one sign-in consumes, in order: the
 * credential lookup, the last_login_at stamp, then the `me` read-back.
 */
const signInQueue = (account: Record<string, unknown>) => [
  { data: account, error: null },
  { data: null, error: null },
  {
    data: {
      ...account,
      events: { id: EVENT, slug: 'slug-event-1', name: 'FAL', status: 'running' },
    },
    error: null,
  },
];

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
    // Argument assertions, not outcomes: this one query carries `.ilike`, so the
    // double cannot narrow it and a seeded fixture would be a lie.
    const lookup = supabase.from.mock.results[1]?.value;
    expect(lookup.eq).toHaveBeenCalledWith('event_id', EVENT);
    expect(lookup.ilike).toHaveBeenCalledWith('username', 'marie');
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
    // maybeSingle hands back whichever row was seeded first.
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
