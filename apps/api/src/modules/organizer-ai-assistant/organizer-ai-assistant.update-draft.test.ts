import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { mockSupabaseFrom, resetHarness, service } from './organizer-ai-assistant.harness';

const DRAFTS = 'organizer_ai_assistant_drafts';
const ACTIONS = [{ kind: 'generate_pools', tournamentId: 't-1', poolCount: 4 }];

const draftRow = (status: string) => ({
  id: 'draft-1',
  event_id: 'event-1',
  draft_type: 'pool_plan',
  status,
  proposed_actions_json: ACTIONS,
  events: { organization_id: 'org-1' },
});

/**
 * The drafts as the read finds them (`before`), then as the write finds them (`then`). The two
 * differ when another tab closed the draft between the service's two requests.
 */
function drafts(before: string, then = before) {
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
    expect(update?.row).toMatchObject({ status: 'rejected', rejected_by_user_id: 'user-1' });
    expect(update?.filters).toEqual([
      { method: 'eq', args: ['id', 'draft-1'] },
      { method: 'eq', args: ['event_id', 'event-1'] },
      { method: 'in', args: ['status', ['draft', 'ready', 'failed']] },
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
