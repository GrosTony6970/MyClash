import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import {
  chain,
  mockGeneratePools,
  mockSupabaseFrom,
  resetHarness,
  service,
  type Chain,
} from './organizer-ai-assistant.harness';

const DRAFTS = 'organizer_ai_assistant_drafts';

/** The row a write was given, or undefined for a read. */
const updateOf = (c: Chain) => c.update.mock.calls[0]?.[0] as Record<string, unknown> | undefined;

const POOLS_4 = { kind: 'generate_pools', tournamentId: 't-1', poolCount: 4 };

/** The draft as it was saved: `ready`, holding `actions`. */
const savedDraft = (actions: Array<Record<string, unknown>>): Record<string, unknown> => ({
  id: 'draft-1',
  event_id: 'event-1',
  draft_type: 'pool_plan',
  status: 'ready',
  proposed_actions_json: actions,
  updated_at: '2026-11-27T09:00:00.000Z',
  events: { organization_id: 'org-1' },
});

/** A drafts query; `.is` too, which the edit's conditional write calls. */
type DraftQuery = Chain & { is: Mock };

/** Does `row` still match every `.eq`, `.in` and `.is` filter of the write `c`? */
function stillMatches(row: Record<string, unknown>, c: DraftQuery): boolean {
  const value = (column: unknown) => row[column as string] ?? null;
  return (
    c.eq.mock.calls.every(([column, wanted]) => value(column) === wanted) &&
    c.in.mock.calls.every(([column, wanted]) => (wanted as unknown[]).includes(value(column))) &&
    c.is.mock.calls.every(([column, wanted]) => value(column) === wanted)
  );
}

/**
 * The drafts table as one stateful row, so two Applies race the way they do in the database. A
 * read answers the row as it is now. A write applies only when its `.eq`, `.in` and `.is`
 * filters still match the row, and answers the row when it did, `null` when it matched nothing.
 * A write awaited with no terminal (the failure mark) applies the same way, since the client's
 * builder is thenable.
 *
 * `afterRead` runs once, after the first read: another tab's write landing between the Apply's
 * read and its claim. `markFails` makes the failure mark answer that database error.
 */
function oneDraft({
  afterRead,
  markFails,
  actions = [POOLS_4],
}: {
  afterRead?: (row: Record<string, unknown>) => void;
  markFails?: string;
  actions?: Array<Record<string, unknown>>;
} = {}) {
  const row = savedDraft(actions);
  let pending = afterRead;
  const queries: Chain[] = [];
  /** Applies `update` when the write's filters still match the row; says whether it did. */
  const write = (c: DraftQuery, update: Record<string, unknown>) => {
    const matches = stillMatches(row, c);
    if (matches) Object.assign(row, update);
    return matches;
  };
  const tournaments = mockSupabase({ tournaments: { rows: [{ id: 't-1', event_id: 'event-1' }] } });
  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === 'tournaments') return tournaments.from(table);
    if (table !== DRAFTS) return chain();
    const c = Object.assign(chain(), { is: vi.fn() });
    c.is.mockReturnValue(c);
    queries.push(c);
    c.maybeSingle.mockImplementation(async () => {
      const update = updateOf(c);
      if (update) return { data: write(c, update) ? { ...row } : null, error: null };
      const read = { ...row };
      pending?.(row);
      pending = undefined;
      return { data: read, error: null };
    });
    Object.assign(c, {
      then: (resolve: (answer: unknown) => void) => {
        const update = updateOf(c);
        if (update && markFails) return resolve({ data: null, error: { message: markFails } });
        if (update) write(c, update);
        resolve({ data: null, error: null });
      },
    });
    return c;
  });
  /** Every write to the drafts, however it was awaited. */
  const writes = () => queries.filter((q) => q.update.mock.calls.length > 0);
  return { row, writes };
}

/**
 * Ruling 996. Marie has the page open in two tabs and presses Apply in both a second apart. Both
 * reads found the draft `ready`, and its actions ran twice: the 4 Pools were generated twice.
 */
describe('OrganizerAIAssistantService.applyDraft, twice at once', () => {
  beforeEach(resetHarness);
  // A spy restored at a test's end stays in place when that test fails first.
  afterEach(() => vi.restoreAllMocks());

  it('runs the actions once; the second Apply refuses with draft_closed', async () => {
    mockGeneratePools.mockResolvedValue({ poolCount: 4 });
    const { row } = oneDraft();

    const [first, second] = await Promise.allSettled([
      service().applyDraft('event-1', 'draft-1', 'user-1'),
      service().applyDraft('event-1', 'draft-1', 'user-1'),
    ]);

    expect(first).toMatchObject({ status: 'fulfilled', value: { status: 'applied' } });
    expect(second).toMatchObject({
      status: 'rejected',
      reason: {
        response: {
          code: 'draft_closed',
          message: 'This draft changed since it was opened. Reload it to see where it stands.',
        },
      },
    });
    expect(mockGeneratePools).toHaveBeenCalledTimes(1);
    expect(row['status']).toBe('applied');
  });

  it('claims the draft with one write that matches a ready row only', async () => {
    mockGeneratePools.mockResolvedValue({ poolCount: 4 });
    const { writes } = oneDraft();

    await service().applyDraft('event-1', 'draft-1', 'user-1');

    // The claim is the only write to the draft: no second "applied" write after the actions.
    expect(writes()).toHaveLength(1);
    const [claim] = writes() as [Chain];
    expect(claim.update.mock.calls).toEqual([
      [
        {
          status: 'applied',
          applied_at: expect.any(String),
          applied_by_user_id: 'user-1',
          updated_at: expect.any(String),
        },
      ],
    ]);
    expect(claim.eq.mock.calls).toEqual([
      ['id', 'draft-1'],
      ['event_id', 'event-1'],
      ['status', 'ready'],
      ['updated_at', '2026-11-27T09:00:00.000Z'],
    ]);
    expect(claim.select.mock.calls).toEqual([['id']]);
  });

  it('refuses, and runs nothing, when another tab edited the draft after the read', async () => {
    // Tab B reads 4 Pools and presses Apply; tab A's edit to 6 Pools lands before B's claim.
    // The row is still `ready`, so only the `updated_at` the Apply read tells the two apart.
    mockGeneratePools.mockResolvedValue({ poolCount: 6 });
    const { row } = oneDraft({
      afterRead: (stored) => {
        stored['proposed_actions_json'] = [
          { kind: 'generate_pools', tournamentId: 't-1', poolCount: 6 },
        ];
        stored['updated_at'] = '2026-11-27T09:00:01.000Z';
      },
    });

    await expect(service().applyDraft('event-1', 'draft-1', 'user-1')).rejects.toMatchObject({
      response: {
        code: 'draft_closed',
        message: 'This draft changed since it was opened. Reload it to see where it stands.',
      },
    });
    expect(mockGeneratePools).not.toHaveBeenCalled();
    expect(row['status']).toBe('ready');
  });

  it('opens a draft whose first action failed again: nothing ran, so it can be applied again', async () => {
    // The claim set `applied_at` before the first action. Kept, it read "Partly applied" and
    // closed the draft for good, though nothing had run.
    mockGeneratePools.mockRejectedValueOnce(new Error('pool phase exists'));
    const { row, writes } = oneDraft();

    await expect(service().applyDraft('event-1', 'draft-1', 'user-1')).rejects.toThrow(
      'pool phase exists',
    );

    const [, failure] = writes() as [Chain, Chain];
    expect(failure.update.mock.calls).toEqual([
      [
        {
          status: 'failed',
          error: 'Partially applied 0/1 action(s) before failing: pool phase exists',
          updated_at: expect.any(String),
          applied_at: null,
          applied_by_user_id: null,
        },
      ],
    ]);
    expect(failure.eq.mock.calls).toEqual([
      ['id', 'draft-1'],
      ['event_id', 'event-1'],
    ]);
    expect(row).toMatchObject({ status: 'failed', applied_at: null, applied_by_user_id: null });
    expect(await service().getDraft('event-1', 'draft-1', 'user-1')).toMatchObject({
      status: 'failed',
      applyStarted: false,
    });

    // The edit makes it `ready` again, and the second Apply runs.
    await service().updateDraft('event-1', 'draft-1', 'user-1', { proposedActions: [POOLS_4] });
    expect(row['status']).toBe('ready');
    mockGeneratePools.mockResolvedValueOnce({ poolCount: 4 });
    await expect(service().applyDraft('event-1', 'draft-1', 'user-1')).resolves.toMatchObject({
      status: 'applied',
    });
  });

  it("keeps the claim's applied_at when a later action fails, so the draft stays closed", async () => {
    // `applied_at` is what closes a partly applied draft (`closedReason`, ruling 997): its first
    // action ran, and an edit back to `ready` and a second Apply would run it again.
    mockGeneratePools
      .mockResolvedValueOnce({ poolCount: 4 })
      .mockRejectedValueOnce(new Error('pool phase exists'));
    const { row, writes } = oneDraft({
      actions: [POOLS_4, { ...POOLS_4, poolCount: 2 }],
    });

    await expect(service().applyDraft('event-1', 'draft-1', 'user-1')).rejects.toThrow(
      'pool phase exists',
    );

    const [claim, failure] = writes() as [Chain, Chain];
    // The failure mark landed on the row (the double applies it), and the claim's mark stayed.
    expect(row).toMatchObject({
      status: 'failed',
      applied_at: updateOf(claim)?.['applied_at'],
      applied_by_user_id: 'user-1',
    });
    expect(failure.update.mock.calls).toEqual([
      [
        {
          status: 'failed',
          error: 'Partially applied 1/2 action(s) before failing: pool phase exists',
          updated_at: expect.any(String),
        },
      ],
    ]);
    const partly = {
      response: { code: 'draft_closed', message: expect.stringContaining('partly applied') },
    };
    await expect(
      service().updateDraft('event-1', 'draft-1', 'user-1', { proposedActions: [POOLS_4] }),
    ).rejects.toMatchObject(partly);
    await expect(service().applyDraft('event-1', 'draft-1', 'user-1')).rejects.toMatchObject(
      partly,
    );
    expect(mockGeneratePools).toHaveBeenCalledTimes(2);
  });

  it("logs a failure mark the database refused, and still throws the action's error", async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockGeneratePools.mockRejectedValue(new Error('pool phase exists'));
    const { row } = oneDraft({ markFails: 'connection reset' });

    await expect(service().applyDraft('event-1', 'draft-1', 'user-1')).rejects.toThrow(
      'pool phase exists',
    );

    expect(logged.mock.calls).toEqual([['Draft draft-1 not marked failed: connection reset']]);
    // What a lost mark leaves (claimDraft's docstring): `applied`, no error, still closed.
    expect(row['status']).toBe('applied');
  });
});
