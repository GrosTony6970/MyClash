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
