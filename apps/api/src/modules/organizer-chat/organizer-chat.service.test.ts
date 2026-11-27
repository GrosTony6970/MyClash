import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  writesTo,
} from '../../common/testing/supabase-chain';
import { OrganizerAIAssistantService } from '../organizer-ai-assistant/organizer-ai-assistant.service';
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

/**
 * Ruling 994. The chat dismisses a proposal through the assistant's own `updateDraft`, so a
 * proposal already applied stays applied: the dismissal refuses and the chat says nothing.
 */
describe('OrganizerChatService.rejectProposal', () => {
  it('refuses to dismiss an applied proposal, and writes nothing', async () => {
    const supabase = mockSupabase({
      events: { rows: [{ id: EVENT, organization_id: 'org-1', name: 'Spring Open' }] },
      organizer_chat_conversations: { rows: [{ id: 'chat-1', event_id: EVENT }] },
      organizer_ai_assistant_drafts: {
        rows: [
          {
            id: 'draft-1',
            event_id: EVENT,
            conversation_id: 'chat-1',
            draft_type: 'pool_plan',
            status: 'applied',
            events: { organization_id: 'org-1' },
          },
        ],
      },
    });
    const organizations = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const none = {} as never;
    const assistant = new OrganizerAIAssistantService(
      supabase as never,
      none,
      organizations as never,
      none,
      none,
      none,
      none,
    );
    const service = new OrganizerChatService(
      supabase as never,
      none,
      organizations as never,
      assistant,
      none,
      none,
    );

    await expect(
      service.rejectProposal(EVENT, 'chat-1', 'draft-1', 'user-1'),
    ).rejects.toMatchObject({
      response: { code: 'draft_closed', message: 'This draft is already applied.' },
    });
    expect(supabase.writes).toEqual([]);
  });
});

/**
 * Call U and ruling 995: a chat proposal is the assistant's own answer for its draft, so the chat
 * card reads the same names as the assistant page ("Longsword Open", never its id).
 */
describe('OrganizerChatService.getConversation', () => {
  it("answers each proposal as the assistant answers its draft, by name, at the chat's Event", async () => {
    const supabase = mockSupabase({
      events: { rows: [{ id: EVENT, organization_id: 'org-1', name: 'Spring Open' }] },
      organizer_chat_conversations: { rows: [{ id: 'chat-1', event_id: EVENT }] },
      organizer_chat_messages: {
        rows: [
          {
            id: 'msg-1',
            conversation_id: 'chat-1',
            role: 'assistant',
            content: 'Four pools.',
            proposed_draft_id: 'draft-1',
          },
        ],
      },
      organizer_ai_assistant_drafts: {
        rows: [
          {
            id: 'draft-1',
            event_id: EVENT,
            draft_type: 'pool_plan',
            status: 'ready',
            proposed_actions_json: [
              { kind: 'generate_pools', tournamentId: OWN_TOURNAMENT, poolCount: 4 },
            ],
          },
        ],
      },
      tournaments: { rows: [{ id: OWN_TOURNAMENT, event_id: EVENT, name: 'Longsword Open' }] },
    });
    const organizations = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const none = {} as never;
    const assistant = new OrganizerAIAssistantService(
      supabase as never,
      none,
      none,
      none,
      none,
      none,
      none,
    );
    const service = new OrganizerChatService(
      supabase as never,
      none,
      organizations as never,
      assistant,
      none,
      none,
    );

    const conversation = await service.getConversation(EVENT, 'chat-1', 'user-1');

    expect(conversation.messages[0]?.proposal).toMatchObject({
      id: 'draft-1',
      status: 'ready',
      readable: [{ kind: 'generate_pools', tournament: { name: 'Longsword Open' }, poolCount: 4 }],
    });
    const drafts = 'organizer_ai_assistant_drafts';
    expect(selectsFor(supabase.from, drafts)).toEqual(['*']);
    expect(filtersFor(supabase.from, drafts, 'eq')).toEqual([['event_id', EVENT]]);
    expect(filtersFor(supabase.from, drafts, 'in')).toEqual([['id', ['draft-1']]]);
  });
});

/** Call S: the chat's write tool call becomes a draft of that one action, `source = 'chat'`. */
describe('OrganizerChatService proposes a write', () => {
  it('hands the assistant the one action, named as the chat', async () => {
    const assistant = { createDraftFromAction: vi.fn().mockResolvedValue({ id: 'draft-1' }) };
    const none = {} as never;
    const service = new OrganizerChatService(none, none, none, assistant as never, none, none);
    const call = {
      id: 'call-1',
      name: 'generate_pools',
      arguments: { tournamentId: OWN_TOURNAMENT, poolCount: 4 },
    };

    await service['proposeWrite'](EVENT, 'user-1', 'chat-1', call, 'Four pools.');

    expect(assistant.createDraftFromAction.mock.calls).toEqual([
      [
        EVENT,
        'user-1',
        [{ kind: 'generate_pools', tournamentId: OWN_TOURNAMENT, poolCount: 4 }],
        {
          source: 'chat',
          conversationId: 'chat-1',
          summary: 'Four pools.',
          tournamentId: OWN_TOURNAMENT,
        },
      ],
    ]);
  });
});
