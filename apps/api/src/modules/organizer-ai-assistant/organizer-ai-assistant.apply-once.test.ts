import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * The drafts table as one stateful row, so two Applies race the way they do in the database. A
 * read answers the row as it is now. A write applies only when its `.eq` filters still match the
 * row, and answers `{ id }` when it did, `null` when it matched nothing. A write awaited with no
 * terminal (the failure mark) applies the same way, since the client's builder is thenable.
 *
 * `afterRead` runs once, after the first read: another tab's write landing between the Apply's
 * read and its claim. `markFails` makes the failure mark answer that database error.
 */
function oneDraft({
  afterRead,
  markFails,
}: { afterRead?: (row: Record<string, unknown>) => void; markFails?: string } = {}) {
  const row: Record<string, unknown> = {
    id: 'draft-1',
    event_id: 'event-1',
    draft_type: 'pool_plan',
    status: 'ready',
    proposed_actions_json: [{ kind: 'generate_pools', tournamentId: 't-1', poolCount: 4 }],
    updated_at: '2026-11-27T09:00:00.000Z',
    events: { organization_id: 'org-1' },
  };
  let pending = afterRead;
  const queries: Chain[] = [];
  /** Applies `update` when the write's `.eq` filters still match the row; says whether it did. */
  const write = (c: Chain, update: Record<string, unknown>) => {
    const matches = c.eq.mock.calls.every(([column, value]) => row[column as string] === value);
    if (matches) Object.assign(row, update);
    return matches;
  };
  const tournaments = mockSupabase({ tournaments: { rows: [{ id: 't-1', event_id: 'event-1' }] } });
  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === 'tournaments') return tournaments.from(table);
    if (table !== DRAFTS) return chain();
    const c = chain();
    queries.push(c);
    c.maybeSingle.mockImplementation(async () => {
      const update = updateOf(c);
      if (update) return { data: write(c, update) ? { id: row['id'] } : null, error: null };
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

  it("keeps the claim's applied_at when an action fails, so the draft stays closed", async () => {
    // `applied_at` is what closes a partly applied draft (`closedReason`); a failure write that
    // cleared it would reopen the draft to an edit back to `ready`.
    mockGeneratePools.mockRejectedValue(new Error('pool phase exists'));
    const { row, writes } = oneDraft();

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
          error: 'Partially applied 0/1 action(s) before failing: pool phase exists',
          updated_at: expect.any(String),
        },
      ],
    ]);
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
    logged.mockRestore();
  });
});
