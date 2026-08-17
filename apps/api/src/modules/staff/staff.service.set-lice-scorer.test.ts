import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';

/**
 * Putting one Scorekeeper on one Lice, from the Live board.
 *
 * The endpoint REPLACES whoever was on that piste: it reads the current
 * assignments, deletes them, then inserts the new one. So the question that
 * matters is which rows the delete takes. Scoped by event but not by Lice, it
 * unassigns every piste at the event; scoped by neither, it unassigns the
 * database.
 *
 * The file used to answer that with a local mock that recorded delete filters
 * into a plain object. The shared double records the same thing as part of
 * every write — `writesTo` plus `scopedTo` — so the recording is no longer this
 * file's job, and the reads are filtered by the real query instead of answered
 * per table name.
 *
 * Decoys throughout: a second piste at the same event, an account at another
 * event, and assignments belonging to both.
 */

const ORG = 'O1';
const EVENT = 'E1';
const OTHER_EVENT = 'E2';
const LICE = 'L1';
const OTHER_LICE = 'L2';

const req = { cookies: {} } as never;

const eventRow = (id: string) => ({
  id,
  organization_id: id === EVENT ? ORG : 'O2',
  slug: `slug-${id}`,
  name: `Event ${id}`,
  status: 'running',
  start_date: '2026-07-21',
  end_date: '2099-12-31',
});

const accountRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  event_id: EVENT,
  display_name: id,
  username: id,
  pin_hash: 'x',
  status: 'active',
  role: 'scoring',
  ...over,
});

const assignment = (staffAccountId: string, liceId = LICE, eventId = EVENT) => ({
  event_id: eventId,
  staff_account_id: staffAccountId,
  lice_id: liceId,
});

function build(
  opts: {
    accounts?: Array<Record<string, unknown>>;
    assignments?: Array<Record<string, unknown>>;
  } = {},
  role: 'ok' | 'deny' = 'ok',
) {
  const supabase = mockSupabase({
    events: { rows: [eventRow(OTHER_EVENT), eventRow(EVENT)] },
    lices: {
      rows: [
        { id: LICE, event_id: EVENT, name: 'Piste 1' },
        { id: OTHER_LICE, event_id: EVENT, name: 'Piste 2' },
      ],
    },
    event_staff_accounts: { rows: opts.accounts ?? [] },
    event_staff_lice_assignments: { rows: opts.assignments ?? [] },
  });
  const assertOrgRole = vi.fn(async () => {
    if (role === 'deny') throw new ForbiddenException('no role');
  });
  const svc = new StaffService(
    supabase as never,
    { assertOrgRole } as never,
    {} as never,
    {} as never,
  );
  vi.spyOn(
    svc as never as { getSupabaseUserId: () => Promise<string> },
    'getSupabaseUserId',
  ).mockResolvedValue('U1');
  return { svc, supabase, assertOrgRole };
}

const deletesOf = (supabase: { writes: Array<{ op: string; table: string }> }) =>
  writesTo(supabase as never, 'event_staff_lice_assignments').filter((w) => w.op === 'delete');

describe('StaffService.setLiceScorer', () => {
  it('requires an org role on the event', async () => {
    const { svc, supabase } = build({}, 'deny');

    await expect(
      svc.setLiceScorer(req, EVENT, LICE, { staffAccountId: 'a1' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(deletesOf(supabase)).toHaveLength(0);
  });

  it('gates on scorekeeper, not editor, and on THIS event’s organisation', async () => {
    // The board is a scorekeeper surface. Requiring `editor` here would make the
    // control useless to the role it exists for. The organisation comes from the
    // event row, so reading the wrong event asks the wrong organisation.
    const { svc, assertOrgRole } = build({ accounts: [accountRow('a1')] });

    await svc.setLiceScorer(req, EVENT, LICE, { staffAccountId: 'a1' } as never);

    expect(assertOrgRole).toHaveBeenCalledWith(ORG, 'U1', 'scorekeeper');
  });

  it('replaces the assignments ON THAT LICE ONLY', async () => {
    const { svc, supabase } = build({ accounts: [accountRow('a2')] });

    await svc.setLiceScorer(req, EVENT, LICE, { staffAccountId: 'a2' } as never);

    // Scoped by BOTH event and lice — a delete missing the lice filter would
    // unassign the whole event.
    const [remove] = deletesOf(supabase);
    expect(scopedTo(remove, 'event_id')).toBe(EVENT);
    expect(scopedTo(remove, 'lice_id')).toBe(LICE);
    const [insert] = writesTo(supabase, 'event_staff_lice_assignments').filter(
      (w) => w.op === 'insert',
    );
    expect(insert?.row).toEqual({ event_id: EVENT, staff_account_id: 'a2', lice_id: LICE });
  });

  it('reports the co-scorers it dropped, and only those on this piste', async () => {
    // `old-elsewhere` sits on the neighbouring piste. It appears in the removed
    // list only if the read that gathers the outgoing scorers stops narrowing.
    const { svc } = build({
      accounts: [accountRow('new')],
      assignments: [
        assignment('old1'),
        assignment('old2'),
        assignment('old-elsewhere', OTHER_LICE),
      ],
    });

    const out = await svc.setLiceScorer(req, EVENT, LICE, { staffAccountId: 'new' } as never);

    expect(out.removedAccountIds.sort()).toEqual(['old1', 'old2']);
    expect(out.staffAccountId).toBe('new');
  });

  it('does not report the incoming account as removed when it was already there', async () => {
    const { svc } = build({
      accounts: [accountRow('same')],
      assignments: [assignment('same')],
    });

    const out = await svc.setLiceScorer(req, EVENT, LICE, { staffAccountId: 'same' } as never);

    expect(out.removedAccountIds).toEqual([]);
  });

  it('clears the piste on a null account, inserting nothing', async () => {
    // "This piste has no scorer" is a state the organizer must be able to SET.
    const { svc, supabase } = build({ assignments: [assignment('old')] });

    const out = await svc.setLiceScorer(req, EVENT, LICE, { staffAccountId: null } as never);

    expect(deletesOf(supabase)).toHaveLength(1);
    expect(
      writesTo(supabase, 'event_staff_lice_assignments').filter((w) => w.op === 'insert'),
    ).toHaveLength(0);
    expect(out.staffAccountId).toBeNull();
    expect(out.removedAccountIds).toEqual(['old']);
  });

  it('refuses a disabled account before touching anything', async () => {
    const { svc, supabase } = build({ accounts: [accountRow('a1', { status: 'disabled' })] });

    await expect(
      svc.setLiceScorer(req, EVENT, LICE, { staffAccountId: 'a1' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(deletesOf(supabase)).toHaveLength(0);
  });

  it('refuses an account that belongs to another event', async () => {
    // getAccountForEvent resolves by event AND id. The account exists; it is
    // simply not this event's staff.
    const { svc, supabase } = build({
      accounts: [accountRow('foreign', { event_id: OTHER_EVENT })],
    });

    await expect(
      svc.setLiceScorer(req, EVENT, LICE, { staffAccountId: 'foreign' } as never),
    ).rejects.toThrow();
    expect(deletesOf(supabase)).toHaveLength(0);
  });
});
