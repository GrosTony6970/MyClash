import { beforeEach, describe, expect, it } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { mockSupabaseFrom, resetHarness, service } from './organizer-ai-assistant.harness';

/**
 * Ruling 997: a draft whose Apply started and then failed reads `failed`, like a draft that
 * failed the shape check. The page must tell the two apart: the first cannot be applied again
 * or rejected. So every draft the assistant answers says whether its Apply started.
 */

const DRAFTS = 'organizer_ai_assistant_drafts';

function withDraft(state: { status: string; applied_at?: string | null }) {
  const db = mockSupabase({
    events: { rows: [{ id: 'event-1', organization_id: 'org-1', timezone: 'Europe/Paris' }] },
    [DRAFTS]: {
      rows: [
        {
          id: 'draft-1',
          event_id: 'event-1',
          draft_type: 'pool_plan',
          proposed_actions_json: [],
          events: { organization_id: 'org-1' },
          ...state,
        },
      ],
    },
  });
  mockSupabaseFrom.mockImplementation((table: string) => db.from(table));
  return db;
}

const STARTED = '2026-11-27T09:00:00.000Z';

describe('a draft says whether its Apply started', () => {
  beforeEach(resetHarness);

  it.each([
    ['a ready draft', { status: 'ready' }, false],
    ['a draft that failed the shape check', { status: 'failed', applied_at: null }, false],
    ['a draft whose Apply started and failed', { status: 'failed', applied_at: STARTED }, true],
    ['an applied draft', { status: 'applied', applied_at: STARTED }, true],
  ])('%s', async (_name, state, started) => {
    const db = withDraft(state);

    const draft = await service().getDraft('event-1', 'draft-1', 'user-1');

    expect(draft.applyStarted).toBe(started);
    expect(draft.status).toBe(state.status);
    expect(selectsFor(db.from, DRAFTS)).toEqual(['*, events(organization_id)']);
    expect(filtersFor(db.from, DRAFTS, 'eq')).toEqual([
      ['id', 'draft-1'],
      ['event_id', 'event-1'],
    ]);
  });

  it('the list says it too', async () => {
    const db = withDraft({ status: 'failed', applied_at: STARTED });

    const [draft] = await service().listDrafts('event-1', 'user-1');

    expect(draft?.applyStarted).toBe(true);
    expect(selectsFor(db.from, DRAFTS)).toEqual(['*']);
    expect(filtersFor(db.from, DRAFTS, 'eq')).toEqual([['event_id', 'event-1']]);
  });
});
