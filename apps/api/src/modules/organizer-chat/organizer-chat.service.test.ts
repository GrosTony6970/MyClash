import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  writesTo,
} from '../../common/testing/supabase-chain';
import { OrganizerChatService } from './organizer-chat.service';

/**
 * A chat may be about one Tournament, and the column's foreign key names
 * `tournaments`, never the chat's Event (migration 0116). So a new chat refuses
 * a Tournament of another Event before it is stored, through the one owner in
 * `events/in-event.ts`.
 */

const EVENT = 'event-1';
const OWN_TOURNAMENT = '11111111-1111-4111-8111-111111111111';
const FOREIGN_TOURNAMENT = '22222222-2222-4222-8222-222222222222';

/** The service over an Event with one Tournament of its own and one of another Event. */
function chat() {
  const supabase = mockSupabase({
    events: { rows: [{ id: EVENT, organization_id: 'org-1', name: 'Spring Open' }] },
    tournaments: {
      rows: [
        { id: OWN_TOURNAMENT, event_id: EVENT },
        { id: FOREIGN_TOURNAMENT, event_id: 'event-2' },
      ],
    },
    organizer_chat_conversations: { rows: [], returning: { id: 'chat-1' } },
  });
  // The org-role check has its own suite; the other collaborators are not reached.
  const organizations = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
  const service = new OrganizerChatService(
    supabase as never,
    {} as never,
    organizations as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { supabase, service };
}

/**
 * The chat's proposal card applies a draft on Confirm, so a referee draft of a team Pool or of a
 * bout of a team Tournament carries `uncheckedFighters`, as on the assistant page (CLAUDE.md
 * rule 8; ADR-016, 2026-11-13). A team's Fighters have no names in slice 1b-1.
 */
describe('OrganizerChatService.getConversation: the referee proposals of a team Pool', () => {
  const TEAM_POOL = '33333333-3333-4333-8333-333333333333';
  const SOLO_POOL = '44444444-4444-4444-8444-444444444444';
  const referee = (id: string, poolId: string) => ({
    id,
    draft_type: 'referee_assignments',
    status: 'ready',
    summary: null,
    proposed_actions_json: [{ kind: 'assign_referee', userId: 'p-1', role: 'referee', poolId }],
    validation_state: { ok: true },
  });
  const message = (id: string, draftId: string) => ({
    id,
    conversation_id: 'chat-1',
    role: 'assistant',
    content: 'Proposed.',
    proposed_draft_id: draftId,
    created_at: `2026-11-25T10:0${id.slice(-1)}:00Z`,
  });
  // Another Event's team Pool, named by a model-written id: the chat's Event scopes the read.
  const FOREIGN_POOL = '55555555-5555-4555-8555-555555555555';
  const EVENT_FILTER = 'phases.tournaments.event_id';
  // The seeded row carries the embedded filter's column under its dotted name, so `.eq` narrows it.
  const ofKind = (id: string, entrant_kind: string, event_id = EVENT) => ({
    id,
    phases: { tournaments: { event_id, entrant_kind } },
    [EVENT_FILTER]: event_id,
  });

  it("marks the team Pool proposal of the chat's Event, and no other", async () => {
    const supabase = mockSupabase({
      events: { rows: [{ id: EVENT, organization_id: 'org-1', name: 'Spring Open' }] },
      organizer_chat_conversations: { rows: [{ id: 'chat-1', event_id: EVENT, title: null }] },
      organizer_chat_messages: {
        rows: [message('m-1', 'd-team'), message('m-2', 'd-solo'), message('m-3', 'd-foreign')],
      },
      organizer_ai_assistant_drafts: {
        rows: [
          referee('d-team', TEAM_POOL),
          referee('d-solo', SOLO_POOL),
          referee('d-foreign', FOREIGN_POOL),
        ],
      },
      pools: {
        rows: [
          ofKind(TEAM_POOL, 'team'),
          ofKind(SOLO_POOL, 'individual'),
          ofKind(FOREIGN_POOL, 'team', 'event-2'),
        ],
      },
      matches: { rows: [] },
    });
    const organizations = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const service = new OrganizerChatService(
      supabase as never,
      {} as never,
      organizations as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const view = await service.getConversation(EVENT, 'chat-1', 'user-1');

    const proposals = view.messages.map((m) => m.proposal as Record<string, unknown>);
    expect(proposals[0]).toHaveProperty('uncheckedFighters', true);
    expect(proposals[1]).not.toHaveProperty('uncheckedFighters');
    expect(proposals[2]).not.toHaveProperty('uncheckedFighters');
    expect(selectsFor(supabase.from, 'organizer_ai_assistant_drafts')).toEqual([
      'id, draft_type, status, summary, proposed_actions_json, validation_state',
    ]);
    expect(selectsFor(supabase.from, 'pools')).toEqual([
      'id, phases!inner(tournaments!inner(event_id, entrant_kind))',
    ]);
    expect(filtersFor(supabase.from, 'pools', 'eq')).toEqual([[EVENT_FILTER, EVENT]]);
  });
});

describe('OrganizerChatService.createConversation', () => {
  it("refuses another Event's Tournament before storing the chat", async () => {
    const { supabase, service } = chat();

    await expect(
      service.createConversation(EVENT, 'user-1', { tournamentId: FOREIGN_TOURNAMENT }),
    ).rejects.toThrow('Every Tournament must belong to this event');

    expect(queriedTables(supabase.from)).toEqual(['events', 'tournaments']);
    expect(writesTo(supabase, 'organizer_chat_conversations')).toEqual([]);
    expect(selectsFor(supabase.from, 'tournaments')).toEqual(['id']);
    expect(filtersFor(supabase.from, 'tournaments', 'eq')).toEqual([['event_id', EVENT]]);
    expect(filtersFor(supabase.from, 'tournaments', 'in')).toEqual([['id', [FOREIGN_TOURNAMENT]]]);
  });

  it("stores a chat about the Event's own Tournament", async () => {
    const { supabase, service } = chat();

    const created = await service.createConversation(EVENT, 'user-1', {
      tournamentId: OWN_TOURNAMENT,
      title: 'Pools',
    });

    expect(filtersFor(supabase.from, 'tournaments', 'in')).toEqual([['id', [OWN_TOURNAMENT]]]);
    const stored = writesTo(supabase, 'organizer_chat_conversations').map(
      (write) => write.row as Record<string, unknown>,
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ event_id: EVENT, tournament_id: OWN_TOURNAMENT });
    expect(created.tournamentId).toBe(OWN_TOURNAMENT);
  });
});
