import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';

/**
 * The Live board — the control-room screen an Event organizer watches.
 *
 * One row per Lice, carrying the bout on it, the Scorekeeper assigned to it and
 * that tablet's sync health. It reads seven queries across five tables in one
 * pass, which is why this file used to carry a local double that applied its own
 * filters: a mock returning every row of a table to every query reports a
 * running bout as the Lice's `lastCompleted`.
 *
 * It is now on the shared seeded double, so the filters are the real ones. Each
 * table below carries at least one decoy — another Event's Lice, another Lice's
 * bout, a voided bout — so a filter that stops narrowing changes an answer here
 * rather than going quiet.
 *
 * `countBoutProgress` reaches its Event through `phases!inner(tournaments!inner(
 * event_id))`, because `matches` has no event_id column. An embedded filter is
 * spelled with a dotted key, so the rows carry
 * `'phases.tournaments.event_id'` flat alongside whatever else they need.
 */

const ORG = 'O1';
const EVENT = 'E1';
const OTHER_EVENT = 'E2';
const LICE = 'L1';
const OTHER_LICE = 'L2';
const ACCOUNT = 'a1';

const req = { cookies: {} } as never;

const eventRow = (id: string) => ({
  id,
  // The decoy belongs to a DIFFERENT organisation. That is what makes the
  // event lookup load-bearing: read the wrong row and the board asks for a
  // role on the wrong organisation, which is the check standing in front of it.
  organization_id: id === EVENT ? ORG : 'O2',
  slug: `slug-${id}`,
  name: `Event ${id}`,
  status: 'running',
  start_date: '2026-07-21',
  end_date: '2099-12-31',
});

/** A bout on a Lice. `scoped` is the embed countBoutProgress filters through. */
const matchRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  lice_id: LICE,
  status: 'scheduled',
  red_score: 0,
  blue_score: 0,
  match_number_label: `#${id}`,
  scheduled_at: '2026-07-21T10:00:00Z',
  started_at: null,
  ended_at: null,
  pool_id: null,
  bracket_slots: null,
  red: null,
  blue: null,
  'phases.tournaments.event_id': EVENT,
  ...over,
});

/**
 * `matches` is ONE seeded table serving all three reads — the live bouts, the
 * completed tail and both head-only counts. That is exactly the case a queue
 * cannot express, because it would have to predict the order they interleave.
 */
const MATCH_ROWS = [
  matchRow('m1', { status: 'running', red_score: 1, started_at: '2026-07-21T10:01:00Z' }),
  matchRow('m0', {
    status: 'completed',
    red_score: 5,
    blue_score: 3,
    scheduled_at: '2026-07-21T09:00:00Z',
    started_at: '2026-07-21T09:00:00Z',
    ended_at: '2026-07-21T09:20:00Z',
  }),
  matchRow('m-void', { status: 'voided' }),
  matchRow('m-done-elsewhere', {
    lice_id: OTHER_LICE,
    status: 'completed',
    ended_at: '2026-07-21T09:30:00Z',
    'phases.tournaments.event_id': OTHER_EVENT,
  }),
  matchRow('m-elsewhere', {
    lice_id: OTHER_LICE,
    status: 'running',
    'phases.tournaments.event_id': OTHER_EVENT,
  }),
];

const account = (id: string, eventId: string, name: string) => ({
  id,
  event_id: eventId,
  display_name: name,
  username: name.toLowerCase(),
  status: 'active',
});

/** The board's tables, each holding a decoy on the axis its query filters by. */
function boardTables(over: Record<string, unknown> = {}) {
  return {
    events: { rows: [eventRow(OTHER_EVENT), eventRow(EVENT)] },
    lices: {
      rows: [
        { id: LICE, event_id: EVENT, name: 'Piste 1', sort_order: 0 },
        { id: OTHER_LICE, event_id: OTHER_EVENT, name: 'Piste 9', sort_order: 1 },
      ],
    },
    matches: { rows: MATCH_ROWS },
    event_staff_accounts: {
      rows: [account(ACCOUNT, EVENT, 'Marie'), account('a9', OTHER_EVENT, 'Jean')],
    },
    event_staff_lice_assignments: {
      rows: [
        { event_id: EVENT, staff_account_id: ACCOUNT, lice_id: LICE },
        { event_id: OTHER_EVENT, staff_account_id: 'a9', lice_id: OTHER_LICE },
      ],
    },
    event_programme_blocks: { rows: [] },
    referee_assignments: { rows: [] },
    ...over,
  };
}

function build(tables: Record<string, unknown>, orgRole: 'allow' | 'refuse' = 'allow') {
  const supabase = mockSupabase(tables as never);
  const assertOrgRole = vi.fn(async () => {
    if (orgRole === 'refuse') throw new ForbiddenException('no role');
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

describe('StaffService.getLiveBoard', () => {
  it('throws 403 when the caller lacks an org role on the event', async () => {
    const { svc } = build(boardTables(), 'refuse');

    await expect(svc.getLiveBoard(req, EVENT)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('shows the pistes of this event only', async () => {
    const { svc } = build(boardTables());

    const out = await svc.getLiveBoard(req, EVENT);

    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.lice.id).toBe(LICE);
  });

  it('puts the running bout in currentMatch and the finished one in history', async () => {
    const { svc } = build(boardTables());

    const out = await svc.getLiveBoard(req, EVENT);

    expect(out.rows[0]!.currentMatch?.id).toBe('m1');
    expect(out.rows[0]!.currentMatch?.redScore).toBe(1);
    expect(out.rows[0]!.queue).toEqual([]);
    expect(out.rows[0]!.lastCompleted?.matchId).toBe('m0');
  });

  it('never shows a bout from a neighbouring event on this board', async () => {
    // `m-elsewhere` is running, on another event's piste. It reaches the board
    // only if the piste read or the bout read stops narrowing.
    const { svc } = build(boardTables());

    const out = await svc.getLiveBoard(req, EVENT);

    const shown = out.rows.flatMap((r) => [r.currentMatch?.id, ...r.queue.map((q) => q.matchId)]);
    expect(shown).not.toContain('m-elsewhere');
  });

  it('counts the bouts of this event, and leaves voided ones out of the total', async () => {
    // Four bouts are seeded: one running, one completed, one voided, one at
    // another event. So this event has 2 that count and 1 of them done.
    const { svc } = build(boardTables());

    const out = await svc.getLiveBoard(req, EVENT);

    expect(out.progress).toEqual({ completed: 1, total: 2 });
  });

  it('shows the scorer assigned to the piste, not one from another event', async () => {
    const { svc } = build(boardTables());

    const out = await svc.getLiveBoard(req, EVENT);

    expect(out.rows[0]!.scorer?.name).toBe('Marie');
  });

  it('offers only this event’s accounts in the reassign picker', async () => {
    // The board ships the account list because a Scorekeeper reassigning a piste
    // cannot call the editor-only endpoint. Nothing downstream re-checks the
    // event, so an unscoped read would offer another event's staff by name.
    const { svc } = build(boardTables());

    const out = await svc.getLiveBoard(req, EVENT);

    expect(out.accounts.map((a) => a.accountId)).toEqual([ACCOUNT]);
  });

  it('resolves the event it was asked for before checking the role', async () => {
    // The decoy event is seeded first and belongs to another organisation. Read
    // the wrong row and the board asks for a role on the wrong organisation —
    // which an organiser of THAT event would pass.
    const { svc, assertOrgRole } = build(boardTables());

    await svc.getLiveBoard(req, EVENT);

    expect(assertOrgRole).toHaveBeenCalledWith(ORG, 'U1', 'scorekeeper');
  });

  it('ships a timing basis even when the event has no programme block', async () => {
    // No block covering "now" is the default case, not an error — most events
    // have no programme at all, and the board still has to date its clock.
    const { svc } = build(boardTables());

    const out = await svc.getLiveBoard(req, EVENT);

    expect(out.timing.block).toBeNull();
    expect(out.timing.matchDurationMinutes).toBe(5);
    expect(Number.isNaN(Date.parse(out.timing.nowIso))).toBe(false);
  });

  it('reads the programme of the day now running, on this event', async () => {
    // The event carries no start date, so `dayIndexFor` returns 0 whatever the
    // clock says. Pinning the day that way keeps the decoys — day two, and
    // another event's day one — as the only things the filters have to reject.
    const block = (id: string, over: Record<string, unknown>) => ({
      id,
      event_id: EVENT,
      day_index: 0,
      label: id,
      start_time: '00:00',
      end_time: '23:59',
      match_duration_minutes: 9,
      sort_order: 0,
      ...over,
    });
    const { svc } = build(
      boardTables({
        events: { rows: [eventRow(OTHER_EVENT), { ...eventRow(EVENT), start_date: null }] },
        event_programme_blocks: {
          rows: [
            block('blk-here', {}),
            block('blk-day2', { day_index: 1, match_duration_minutes: 4 }),
            block('blk-other-event', { event_id: OTHER_EVENT, match_duration_minutes: 3 }),
          ],
        },
      }),
    );

    const out = await svc.getLiveBoard(req, EVENT);

    expect(out.timing.block?.id).toBe('blk-here');
    expect(out.timing.matchDurationMinutes).toBe(9);
  });
});

describe('StaffService.acknowledgeAttention', () => {
  it('clears the flag on the named account, scoped to the event', async () => {
    const { svc, supabase } = build(boardTables());

    await expect(svc.acknowledgeAttention(req, EVENT, ACCOUNT)).resolves.toEqual({ ok: true });

    const [write] = writesTo(supabase, 'event_staff_accounts');
    expect(write?.row).toMatchObject({ needs_attention: false, needs_attention_reason: null });
    expect(scopedTo(write, 'event_id')).toBe(EVENT);
    expect(scopedTo(write, 'id')).toBe(ACCOUNT);
  });
});
