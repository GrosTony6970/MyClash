import { beforeEach, describe, expect, it } from 'vitest';
import { filtersFor, queriedTables } from '../../common/testing/supabase-chain';
import { mockSupabaseFrom, resetHarness, service } from './organizer-ai-assistant.harness';
import {
  EVENT,
  MATCH,
  MISSING,
  seeded,
  POOLS_DRAFT,
  SCHEDULE_DRAFT,
  LSW_P2_M4,
} from './readable-draft.fixtures';

/** Call U: every draft the assistant answers carries its actions by name. */

/** The drafts at the Event, as the assistant's list reads them. */
function withDrafts(...drafts: unknown[][]) {
  const db = seeded({
    events: { rows: [{ id: EVENT, organization_id: 'org-1', timezone: 'Europe/Paris' }] },
    organizer_ai_assistant_drafts: {
      rows: drafts.map((actions, index) => ({
        id: `draft-${index + 1}`,
        event_id: EVENT,
        draft_type: 'schedule_grid',
        status: 'ready',
        proposed_actions_json: actions,
        created_at: `2026-11-27T10:0${index}:00.000Z`,
        events: { organization_id: 'org-1' },
      })),
    },
  });
  mockSupabaseFrom.mockImplementation((table: string) => db.from(table));
  return db;
}

describe('the assistant answers each draft with its names', () => {
  beforeEach(resetHarness);

  it('lists three drafts with one read per table, not one per draft', async () => {
    const db = withDrafts(SCHEDULE_DRAFT, SCHEDULE_DRAFT, POOLS_DRAFT);

    const drafts = await service().listDrafts(EVENT, 'user-1');

    expect(drafts.map((draft) => draft.readable.map((action) => action.kind))).toEqual([
      ['generate_pools'],
      ['schedule_match'],
      ['schedule_match'],
    ]);
    expect(queriedTables(db.from)).toEqual([
      'events',
      'organizer_ai_assistant_drafts',
      'tournaments',
      'matches',
      'lices',
      'events',
    ]);
    expect(filtersFor(db.from, 'matches', 'in')).toEqual([['id', [MATCH]]]);
  });

  it('still lists a draft whose ids are no uuids, the round code the model passed included', async () => {
    const db = withDrafts([
      { kind: 'schedule_match', matchId: 'LSW-P2-M04', liceId: 'Piste 2', scheduledAt: 'x' },
    ]);

    const [draft] = await service().listDrafts(EVENT, 'user-1');

    expect(draft?.readable).toEqual([
      {
        kind: 'schedule_match',
        match: MISSING,
        piste: MISSING,
        startsAt: null,
        timezone: 'Europe/Paris',
      },
    ]);
    expect(queriedTables(db.from)).toEqual(['events', 'organizer_ai_assistant_drafts', 'events']);
  });

  it('answers one draft with its names', async () => {
    withDrafts(SCHEDULE_DRAFT);

    const draft = await service().getDraft(EVENT, 'draft-1', 'user-1');

    expect(draft.readable).toEqual([
      {
        kind: 'schedule_match',
        match: LSW_P2_M4,
        piste: { name: 'Piste 2' },
        startsAt: '2026-12-05T13:30:00.000Z',
        timezone: 'Europe/Paris',
      },
    ]);
    expect(draft.proposedActions).toEqual(SCHEDULE_DRAFT);
  });
});
