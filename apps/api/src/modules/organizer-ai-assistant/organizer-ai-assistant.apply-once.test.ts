import { beforeEach, describe, expect, it } from 'vitest';
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

/**
 * The drafts table as one stateful row, so two Applies race the way they do in the database. A
 * read answers the row as it is now. A write applies only when its `.eq` filters still match the
 * row, and answers `{ id }` when it did, `null` when it matched nothing.
 */
function oneDraft() {
  const row: Record<string, unknown> = {
    id: 'draft-1',
    event_id: 'event-1',
    draft_type: 'pool_plan',
    status: 'ready',
    proposed_actions_json: [{ kind: 'generate_pools', tournamentId: 't-1', poolCount: 4 }],
    events: { organization_id: 'org-1' },
  };
  const queries: Chain[] = [];
  const tournaments = mockSupabase({ tournaments: { rows: [{ id: 't-1', event_id: 'event-1' }] } });
  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === 'tournaments') return tournaments.from(table);
    if (table !== DRAFTS) return chain();
    const c = chain();
    queries.push(c);
    c.maybeSingle.mockImplementation(async () => {
      const update = c.update.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      if (!update) return { data: { ...row }, error: null };
      const matches = c.eq.mock.calls.every(([column, value]) => row[column as string] === value);
      if (!matches) return { data: null, error: null };
      Object.assign(row, update);
      return { data: { id: row['id'] }, error: null };
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
          message: 'This draft is already applied, being applied, or rejected.',
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
    ]);
    expect(claim.select.mock.calls).toEqual([['id']]);
  });
});
