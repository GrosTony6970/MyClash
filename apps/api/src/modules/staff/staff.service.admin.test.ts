import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';

/**
 * The staff-admin write surface — the organiser's account management screen.
 *
 * Until this file, `listAccounts`, `updateAccount`, `resetPin` and `setLices`
 * had NO unit tests at all. Not weak ones: no caller anywhere in the API suite
 * executed them, so every filter in them was load-bearing in nothing.
 *
 * That matters more here than elsewhere because these queries run on
 * `supabase.service`, the service-role client, which BYPASSES RLS. There is no
 * database-side row filter underneath them to catch a mistake — the
 * `.eq('event_id', …)` in the query IS the boundary between one event's staff
 * accounts and another's.
 *
 * So the cases below are built around that boundary. Each one seeds exactly one
 * decoy on the axis it is testing, because a decoy on a second axis would change
 * which failure the test proves. Where a write is read back through
 * `.select(...).single()`, remember the double records writes rather than
 * applying them: what comes back is the seed, and what was SET is asserted from
 * `writesTo`.
 */

const ORG = 'org-1';
const EVENT = 'event-1';
const OTHER_EVENT = 'event-2';
const USER = 'user-1';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const SIBLING = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '99999999-9999-4999-8999-999999999999';

const LICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_LICE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FOREIGN_LICE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const eventRow = (id: string, organizationId = ORG) => ({
  id,
  organization_id: organizationId,
  slug: `slug-${id}`,
  name: `Event ${id}`,
  status: 'running',
  start_date: '2026-08-08',
  end_date: '2099-12-31',
});

const accountRow = (id: string, eventId: string, over: Record<string, unknown> = {}) => ({
  id,
  event_id: eventId,
  display_name: 'Marie Dubois',
  username: 'marie',
  pin_hash: 'stored-hash',
  status: 'active',
  role: 'scoring',
  ...over,
});

/**
 * `assertCanManageEventStaff` reads the event, then asks OrganizationsService
 * for an `editor` role — so `orgs` is the stub that decides allow or refuse, and
 * `events` still has to be seeded for the read in front of it.
 */
function build(
  tables: Record<string, { rows: Array<Record<string, unknown>> }>,
  orgRole: 'allow' | 'refuse' = 'allow',
) {
  const supabase = mockSupabase({
    events: { rows: [eventRow(EVENT), eventRow(OTHER_EVENT)] },
    ...tables,
  });
  const assertOrgRole = vi.fn(async () => {
    if (orgRole === 'refuse') throw new Error('not an editor');
  });
  const service = new StaffService(
    supabase as never,
    { assertOrgRole } as never,
    {} as never,
    {} as never,
  );
  return { service, supabase, assertOrgRole };
}

describe('StaffService.listAccounts', () => {
  it('lists only the accounts belonging to the event', async () => {
    // The decoy is a whole staff account sitting in another organiser's event.
    // Without the event scope it lands in this event's roster, complete with
    // its username.
    const { service } = build({
      event_staff_accounts: {
        rows: [accountRow(ACCOUNT, EVENT), accountRow(FOREIGN, OTHER_EVENT)],
      },
      event_staff_lice_assignments: { rows: [] },
    });

    const accounts = await service.listAccounts(EVENT, USER);

    expect(accounts.map((a) => (a as { id: string }).id)).toEqual([ACCOUNT]);
  });

  it('refuses a caller without an editor role on the event', async () => {
    const { service } = build(
      { event_staff_accounts: { rows: [] }, event_staff_lice_assignments: { rows: [] } },
      'refuse',
    );

    await expect(service.listAccounts(EVENT, USER)).rejects.toThrow('not an editor');
  });
});

describe('StaffService.updateAccount', () => {
  it('refuses to edit a staff account that belongs to another event', async () => {
    // The account exists — it is simply not this event's. Dropping the event
    // scope turns this into a successful cross-event edit.
    //
    // The refusal arrives as a 400, not the 404 the source appears to intend:
    // the read-back is `.single()`, which errors PGRST116 on nothing found, and
    // that throws one line before `if (!data) throw new NotFoundException`.
    // That NotFoundException is unreachable here and in resetPin below.
    const { service, supabase } = build({
      event_staff_accounts: { rows: [accountRow(FOREIGN, OTHER_EVENT)] },
    });

    await expect(
      service.updateAccount(EVENT, FOREIGN, { status: 'disabled' } as never, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
    // The UPDATE is still issued; it simply matches nothing. What keeps it from
    // landing on the other event's row is the scope, which is asserted here.
    const [write] = writesTo(supabase, 'event_staff_accounts');
    expect(scopedTo(write, 'event_id')).toBe(EVENT);
  });

  it('edits the named account when the event holds more than one', async () => {
    // Two accounts, same event: the id is the only thing separating them, so
    // dropping it makes the read-back ambiguous and the update unscoped.
    const { service, supabase } = build({
      event_staff_accounts: {
        rows: [accountRow(ACCOUNT, EVENT), accountRow(SIBLING, EVENT, { username: 'jean' })],
      },
    });

    await service.updateAccount(EVENT, ACCOUNT, { displayName: '  Marie D  ' } as never, USER);

    const [write] = writesTo(supabase, 'event_staff_accounts');
    expect(scopedTo(write, 'id')).toBe(ACCOUNT);
    expect(scopedTo(write, 'event_id')).toBe(EVENT);
    expect(write?.row).toMatchObject({ display_name: 'Marie D' });
  });
});

describe('StaffService.resetPin', () => {
  it('refuses to reset a PIN on an account from another event', async () => {
    const { service } = build({
      event_staff_accounts: { rows: [accountRow(FOREIGN, OTHER_EVENT)] },
    });

    await expect(
      service.resetPin(EVENT, FOREIGN, { pin: '246810' } as never, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resets the PIN of the named account only', async () => {
    const { service, supabase } = build({
      event_staff_accounts: {
        rows: [accountRow(ACCOUNT, EVENT), accountRow(SIBLING, EVENT, { username: 'jean' })],
      },
    });

    await service.resetPin(EVENT, ACCOUNT, { pin: '246810' } as never, USER);

    const [write] = writesTo(supabase, 'event_staff_accounts');
    expect(scopedTo(write, 'id')).toBe(ACCOUNT);
    expect(scopedTo(write, 'event_id')).toBe(EVENT);
    // The stored hash must not be the PIN, and must have changed.
    const row = write?.row as { pin_hash: string };
    expect(row.pin_hash).not.toContain('246810');
    expect(row.pin_hash).not.toBe('stored-hash');
  });
});

describe('StaffService.setLices', () => {
  const licesForEvent = {
    lices: {
      rows: [
        { id: LICE, event_id: EVENT },
        { id: OTHER_LICE, event_id: EVENT },
        { id: FOREIGN_LICE, event_id: OTHER_EVENT },
      ],
    },
  };

  it('clears the assignments of the target account only', async () => {
    // The DELETE that replaces an account's pistes is scoped by
    // `staff_account_id` and by nothing else. Unscoped it would take every
    // assignment in the table, for every account in every event.
    const { service, supabase } = build({
      event_staff_accounts: {
        rows: [accountRow(ACCOUNT, EVENT), accountRow(SIBLING, EVENT, { username: 'jean' })],
      },
      event_staff_lice_assignments: {
        rows: [
          { id: 'asg-1', event_id: EVENT, staff_account_id: ACCOUNT, lice_id: LICE },
          { id: 'asg-2', event_id: EVENT, staff_account_id: SIBLING, lice_id: OTHER_LICE },
        ],
      },
      ...licesForEvent,
    });

    await service.setLices(EVENT, ACCOUNT, { liceIds: [OTHER_LICE] } as never, USER);

    const [remove] = writesTo(supabase, 'event_staff_lice_assignments').filter(
      (w) => w.op === 'delete',
    );
    expect(scopedTo(remove, 'staff_account_id')).toBe(ACCOUNT);
  });

  it('acts on the account that was asked for when the event holds two', async () => {
    // `getAccountForEvent` resolves by id through maybeSingle, which returns the
    // FIRST surviving row rather than erroring — so losing the id filter picks a
    // neighbour silently and clears their pistes instead.
    const { service, supabase } = build({
      event_staff_accounts: {
        rows: [accountRow(SIBLING, EVENT, { username: 'jean' }), accountRow(ACCOUNT, EVENT)],
      },
      event_staff_lice_assignments: { rows: [] },
      ...licesForEvent,
    });

    await service.setLices(EVENT, ACCOUNT, { liceIds: [] } as never, USER);

    const [remove] = writesTo(supabase, 'event_staff_lice_assignments');
    expect(scopedTo(remove, 'staff_account_id')).toBe(ACCOUNT);
  });

  it('refuses an account that belongs to another event', async () => {
    const { service, supabase } = build({
      event_staff_accounts: { rows: [accountRow(FOREIGN, OTHER_EVENT)] },
      event_staff_lice_assignments: { rows: [] },
      ...licesForEvent,
    });

    await expect(
      service.setLices(EVENT, FOREIGN, { liceIds: [] } as never, USER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(writesTo(supabase, 'event_staff_lice_assignments')).toHaveLength(0);
  });

  it('refuses a lice that belongs to another event', async () => {
    const { service, supabase } = build({
      event_staff_accounts: { rows: [accountRow(ACCOUNT, EVENT)] },
      event_staff_lice_assignments: { rows: [] },
      ...licesForEvent,
    });

    await expect(
      service.setLices(EVENT, ACCOUNT, { liceIds: [FOREIGN_LICE] } as never, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(writesTo(supabase, 'event_staff_lice_assignments')).toHaveLength(0);
  });

  it('accepts a subset of the lices the event owns', async () => {
    // The count check compares what came back against what was asked for. Lose
    // the `in(id)` narrowing and every lice in the event comes back, so asking
    // for one of two reads as a mismatch and a legitimate call is refused.
    const { service, supabase } = build({
      event_staff_accounts: { rows: [accountRow(ACCOUNT, EVENT)] },
      event_staff_lice_assignments: { rows: [] },
      ...licesForEvent,
    });

    const result = await service.setLices(EVENT, ACCOUNT, { liceIds: [LICE] } as never, USER);

    expect(result).toEqual({ staffAccountId: ACCOUNT, liceIds: [LICE] });
    const [, insert] = writesTo(supabase, 'event_staff_lice_assignments');
    expect(insert?.row).toEqual([{ event_id: EVENT, staff_account_id: ACCOUNT, lice_id: LICE }]);
  });
});
