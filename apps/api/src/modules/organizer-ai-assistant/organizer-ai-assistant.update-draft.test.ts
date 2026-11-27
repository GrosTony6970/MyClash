import { ConflictException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import {
  mockGeneratePools,
  mockSupabaseFrom,
  resetHarness,
  service,
} from './organizer-ai-assistant.harness';

const DRAFTS = 'organizer_ai_assistant_drafts';
const ACTIONS = [{ kind: 'generate_pools', tournamentId: 't-1', poolCount: 4 }];

/** A draft whose Apply claimed it, ran its first action and failed on the next. */
const PARTLY_APPLIED = { status: 'failed', applied_at: '2026-11-27T09:00:00.000Z' };

/** The row in a given state: a status, or a status with the columns an Apply wrote. */
type DraftState = string | { status: string; applied_at?: string };

const draftRow = (state: DraftState) => ({
  id: 'draft-1',
  event_id: 'event-1',
  draft_type: 'pool_plan',
  proposed_actions_json: ACTIONS,
  events: { organization_id: 'org-1' },
  ...(typeof state === 'string' ? { status: state } : state),
});

/**
 * The drafts as the read finds them (`before`), then as the write finds them (`then`). The two
 * differ when another tab closed the draft between the service's two requests.
 */
function drafts(before: DraftState, then = before) {
  const read = mockSupabase({ [DRAFTS]: { rows: [draftRow(before)] } });
  const write = mockSupabase({
    [DRAFTS]: { rows: [draftRow(then)] },
    audit_log: { data: null, error: null },
  });
  let draftCalls = 0;
  mockSupabaseFrom.mockImplementation((table: string) =>
    table === DRAFTS && draftCalls++ === 0 ? read.from(table) : write.from(table),
  );
  return { read, write };
}

const refusal = (message: string) => ({ response: { code: 'draft_closed', message } });

const PARTLY_APPLIED_REFUSAL = refusal(
  'This draft was partly applied before it failed. It cannot be changed, applied again or rejected.',
);

/** The clock, pinned so a write's timestamps can be asserted whole. */
const NOW = '2026-11-27T10:00:00.000Z';
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * Ruling 994. Marie applies a draft that generates 4 Pools. An edit of its actions used to make it
 * `ready` again, and a second Apply generated the Pools again. An applied or rejected draft is
 * closed: nothing changes it.
 */
describe('OrganizerAIAssistantService.updateDraft', () => {
  beforeEach(resetHarness);

  it.each(['applied', 'rejected'])(
    'refuses new actions on a %s draft, and writes nothing',
    async (status) => {
      const { read, write } = drafts(status);

      const edit = service().updateDraft('event-1', 'draft-1', 'user-1', {
        proposedActions: ACTIONS,
        status: 'ready',
      });

      await expect(edit).rejects.toBeInstanceOf(ConflictException);
      await expect(edit).rejects.toMatchObject(refusal(`This draft is already ${status}.`));
      expect([...read.writes, ...write.writes]).toEqual([]);
    },
  );

  it('refuses to reject an applied draft', async () => {
    const { write } = drafts('applied');

    await expect(
      service().updateDraft('event-1', 'draft-1', 'user-1', { status: 'rejected' }),
    ).rejects.toMatchObject(refusal('This draft is already applied.'));
    expect(writesTo(write, DRAFTS)).toEqual([]);
  });

  it.each(['ready', 'failed'])('still rejects a %s draft, on an open row only', async (status) => {
    const { write } = drafts(status);

    const draft = await service().updateDraft('event-1', 'draft-1', 'user-1', {
      status: 'rejected',
    });

    expect(draft.id).toBe('draft-1');
    const [update] = writesTo(write, DRAFTS);
    expect(update?.row).toEqual({
      updated_at: NOW,
      status: 'rejected',
      rejected_at: NOW,
      rejected_by_user_id: 'user-1',
    });
    expect(update?.filters).toEqual([
      { method: 'eq', args: ['id', 'draft-1'] },
      { method: 'eq', args: ['event_id', 'event-1'] },
      { method: 'in', args: ['status', ['draft', 'ready', 'failed']] },
      { method: 'is', args: ['applied_at', null] },
    ]);
    expect(selectsFor(write.from, DRAFTS)).toEqual(['*']);
  });

  it('refuses an edit when another tab applied the draft after it was read', async () => {
    // The read finds it `ready`; by the write, an Apply has closed it.
    const { write } = drafts('ready', 'applied');

    await expect(
      service().updateDraft('event-1', 'draft-1', 'user-1', {
        proposedActions: ACTIONS,
        status: 'ready',
      }),
    ).rejects.toMatchObject(refusal('This draft is already applied or rejected.'));
    expect(writesTo(write, 'audit_log')).toEqual([]);
  });
});

/**
 * The same hole, through a failed Apply. Marie applies a draft that creates two Tournaments; the
 * first is created, the second fails, and the draft reads `failed` ("Partially applied 1/2…"). An
 * edit back to `ready` and a second Apply created the first Tournament again. The claim's
 * `applied_at` stays on the row: a draft whose Apply started is closed whatever its status.
 */
describe('a draft whose Apply started and then failed', () => {
  beforeEach(resetHarness);

  it('refuses new actions, and writes nothing', async () => {
    const { read, write } = drafts(PARTLY_APPLIED);

    await expect(
      service().updateDraft('event-1', 'draft-1', 'user-1', {
        proposedActions: ACTIONS,
        status: 'ready',
      }),
    ).rejects.toMatchObject(PARTLY_APPLIED_REFUSAL);
    expect([...read.writes, ...write.writes]).toEqual([]);
  });

  it('refuses a reject: it stays failed (ruling 997), and nothing is written', async () => {
    const { read, write } = drafts(PARTLY_APPLIED);

    await expect(
      service().updateDraft('event-1', 'draft-1', 'user-1', { status: 'rejected' }),
    ).rejects.toMatchObject(PARTLY_APPLIED_REFUSAL);
    expect([...read.writes, ...write.writes]).toEqual([]);
  });

  it('refuses a second Apply, and runs no action', async () => {
    const { read, write } = drafts(PARTLY_APPLIED);

    await expect(service().applyDraft('event-1', 'draft-1', 'user-1')).rejects.toMatchObject(
      PARTLY_APPLIED_REFUSAL,
    );
    expect(mockGeneratePools).not.toHaveBeenCalled();
    expect([...read.writes, ...write.writes]).toEqual([]);
  });

  it('refuses an edit when the Apply started and failed after the read', async () => {
    const { write } = drafts('ready', PARTLY_APPLIED);

    await expect(
      service().updateDraft('event-1', 'draft-1', 'user-1', {
        proposedActions: ACTIONS,
        status: 'ready',
      }),
    ).rejects.toMatchObject(refusal('This draft is already applied or rejected.'));
    expect(writesTo(write, 'audit_log')).toEqual([]);
  });

  it('leaves a draft that failed the shape check open to new actions', async () => {
    // Never applied: no `applied_at`.
    const { write } = drafts('failed');

    await service().updateDraft('event-1', 'draft-1', 'user-1', {
      proposedActions: ACTIONS,
      status: 'ready',
    });

    const [update] = writesTo(write, DRAFTS);
    expect(update?.row).toEqual({
      updated_at: NOW,
      proposed_actions_json: ACTIONS,
      validation_state: { ok: true, warnings: [], errors: [] },
      status: 'ready',
      error: null,
    });
  });
});
