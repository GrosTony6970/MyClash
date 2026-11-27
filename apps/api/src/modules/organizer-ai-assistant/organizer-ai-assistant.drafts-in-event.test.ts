import { beforeEach, describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  writesTo,
} from '../../common/testing/supabase-chain';
import {
  mockGenerateWithCap,
  mockSupabaseFrom,
  resetHarness,
  service,
} from './organizer-ai-assistant.harness';

/**
 * A draft stores the Tournament it is about, and the column's foreign key names
 * `tournaments`, never the draft's Event (migration 0031). Applying a draft
 * checks its action's Tournament again, so the harm was a stored foreign id.
 * Both doors that create a draft refuse one before they write, through the one
 * owner in `events/in-event.ts`.
 */

const EVENT = 'event-1';
const OWN_TOURNAMENT = '11111111-1111-4111-8111-111111111111';
const FOREIGN_TOURNAMENT = '22222222-2222-4222-8222-222222222222';

/** An Event with an AI key, one Tournament of its own and one of another Event. */
function seeded() {
  const supabase = mockSupabase({
    events: { rows: [{ id: EVENT, organization_id: 'org-1', name: 'Spring Open' }] },
    organization_ai_keys: { rows: [{ id: 'key-1', organization_id: 'org-1', is_active: true }] },
    tournaments: {
      rows: [
        { id: OWN_TOURNAMENT, event_id: EVENT },
        { id: FOREIGN_TOURNAMENT, event_id: 'event-2' },
      ],
    },
    organizer_ai_assistant_drafts: { rows: [], returning: { id: 'draft-1' } },
    audit_log: { data: null, error: null },
  });
  mockSupabaseFrom.mockImplementation((table: string) => supabase.from(table));
  return supabase;
}

const poolsAction = (tournamentId: string) => ({
  kind: 'generate_pools',
  tournamentId,
  targetSize: 8,
});

/** The Tournament id each stored draft names. */
const storedTournaments = (supabase: ReturnType<typeof seeded>) =>
  writesTo(supabase, 'organizer_ai_assistant_drafts').map(
    (write) => (write.row as Record<string, unknown>)['tournament_id'],
  );

function expectOneTournamentRead(supabase: ReturnType<typeof seeded>, tournamentId: string) {
  expect(selectsFor(supabase.from, 'tournaments')).toEqual(['id']);
  expect(filtersFor(supabase.from, 'tournaments', 'eq')).toEqual([['event_id', EVENT]]);
  expect(filtersFor(supabase.from, 'tournaments', 'in')).toEqual([['id', [tournamentId]]]);
}

/**
 * A stored draft: the membership check of `checked`, then the answer's read of the name of the
 * Tournament its action holds, `named` (call U).
 */
function expectCheckThenNameRead(
  supabase: ReturnType<typeof seeded>,
  checked: string,
  named = checked,
) {
  expect(selectsFor(supabase.from, 'tournaments')).toEqual(['id', 'id, name']);
  expect(filtersFor(supabase.from, 'tournaments', 'eq')).toEqual([
    ['event_id', EVENT],
    ['event_id', EVENT],
  ]);
  expect(filtersFor(supabase.from, 'tournaments', 'in')).toEqual([
    ['id', [checked]],
    ['id', [named]],
  ]);
}

describe('createDraft', () => {
  beforeEach(resetHarness);

  it("refuses another Event's Tournament before asking the model or storing a draft", async () => {
    const supabase = seeded();

    await expect(
      service().createDraft(EVENT, 'user-1', {
        draftType: 'pool_plan',
        prompt: 'Make good pools',
        tournamentId: FOREIGN_TOURNAMENT,
      }),
    ).rejects.toThrow('Every Tournament must belong to this event');

    expect(queriedTables(supabase.from)).toEqual(['events', 'tournaments']);
    expect(mockGenerateWithCap).not.toHaveBeenCalled();
    expect(storedTournaments(supabase)).toEqual([]);
    expectOneTournamentRead(supabase, FOREIGN_TOURNAMENT);
  });

  it("stores a draft about the Event's own Tournament", async () => {
    const supabase = seeded();

    await service().createDraft(EVENT, 'user-1', {
      draftType: 'pool_plan',
      prompt: 'Make good pools',
      tournamentId: OWN_TOURNAMENT,
    });

    // The model's action names `t-1` (the harness's answer): the form flow checks only the
    // Tournament the organiser picked, and the answer names whatever the action holds.
    expectCheckThenNameRead(supabase, OWN_TOURNAMENT, 't-1');
    expect(storedTournaments(supabase)).toEqual([OWN_TOURNAMENT]);
  });
});

describe('createDraftFromAction', () => {
  beforeEach(resetHarness);

  it("refuses another Event's Tournament that the model named in its tool call", async () => {
    const supabase = seeded();

    await expect(
      service().createDraftFromAction(EVENT, 'user-1', [poolsAction(FOREIGN_TOURNAMENT)], {
        source: 'chat',
      }),
    ).rejects.toThrow('Every Tournament must belong to this event');

    expect(storedTournaments(supabase)).toEqual([]);
    expectOneTournamentRead(supabase, FOREIGN_TOURNAMENT);
  });

  it("stores a chat draft about the Event's own Tournament", async () => {
    const supabase = seeded();

    await service().createDraftFromAction(EVENT, 'user-1', [poolsAction(OWN_TOURNAMENT)], {
      source: 'chat',
      conversationId: 'chat-1',
      tournamentId: OWN_TOURNAMENT,
    });

    expectCheckThenNameRead(supabase, OWN_TOURNAMENT);
    expect(storedTournaments(supabase)).toEqual([OWN_TOURNAMENT]);
  });

  it('checks the Tournament the draft stores as well as the one its action names', async () => {
    const supabase = seeded();

    await expect(
      service().createDraftFromAction(EVENT, 'user-1', [poolsAction(OWN_TOURNAMENT)], {
        source: 'chat',
        conversationId: 'chat-1',
        tournamentId: FOREIGN_TOURNAMENT,
      }),
    ).rejects.toThrow('Every Tournament must belong to this event');

    expect(storedTournaments(supabase)).toEqual([]);
    expect(filtersFor(supabase.from, 'tournaments', 'in')).toEqual([
      ['id', [FOREIGN_TOURNAMENT, OWN_TOURNAMENT]],
    ]);
  });

  it("refuses another Event's Tournament named by the SECOND action, as by the first", async () => {
    const supabase = seeded();

    await expect(
      service().createDraftFromAction(
        EVENT,
        'user-1',
        [poolsAction(OWN_TOURNAMENT), poolsAction(FOREIGN_TOURNAMENT)],
        { source: 'mcp' },
      ),
    ).rejects.toThrow('Every Tournament must belong to this event');

    expect(storedTournaments(supabase)).toEqual([]);
    expect(selectsFor(supabase.from, 'tournaments')).toEqual(['id']);
    expect(filtersFor(supabase.from, 'tournaments', 'eq')).toEqual([['event_id', EVENT]]);
    expect(filtersFor(supabase.from, 'tournaments', 'in')).toEqual([
      ['id', [OWN_TOURNAMENT, FOREIGN_TOURNAMENT]],
    ]);
  });
});
