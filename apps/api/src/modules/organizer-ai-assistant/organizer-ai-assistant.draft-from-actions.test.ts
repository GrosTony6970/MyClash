import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase, queriedTables, writesTo } from '../../common/testing/supabase-chain';
import { mockSupabaseFrom, resetHarness, service } from './organizer-ai-assistant.harness';

/**
 * Calls S and T (MCP slice 4b). Marie asks the in-app chat to make 4 Pools: the chat saves a
 * draft of one action, `source = 'chat'`, and its AI usage is the chat's. Later she asks Claude
 * to put two Matches on pistes: Claude saves ONE draft of two actions through the MCP server,
 * `source = 'mcp'`, and MyClash spent no AI usage on it (call D). The row and its audit row say
 * which, whole.
 */

const EVENT = 'event-1';
const TOURNAMENT = '11111111-1111-4111-8111-111111111111';
const DRAFTS = 'organizer_ai_assistant_drafts';

function seeded() {
  const supabase = mockSupabase({
    events: { rows: [{ id: EVENT, organization_id: 'org-1', name: 'Spring Open' }] },
    tournaments: { rows: [{ id: TOURNAMENT, event_id: EVENT }] },
    [DRAFTS]: { rows: [], returning: { id: 'draft-1' } },
    audit_log: { data: null, error: null },
  });
  mockSupabaseFrom.mockImplementation((table: string) => supabase.from(table));
  return supabase;
}

const rowsTo = (supabase: ReturnType<typeof seeded>, table: string) =>
  writesTo(supabase, table).map((write) => ({ op: write.op, row: write.row }));

const pools = { kind: 'generate_pools', tournamentId: TOURNAMENT, poolCount: 4 };
const placements = [
  {
    kind: 'schedule_match',
    matchId: 'match-1',
    liceId: 'lice-1',
    scheduledAt: '2026-12-05T13:30:00.000Z',
  },
  {
    kind: 'schedule_match',
    matchId: 'match-2',
    liceId: 'lice-2',
    scheduledAt: '2026-12-05T13:45:00.000Z',
  },
];

describe('createDraftFromAction, by source', () => {
  beforeEach(resetHarness);

  it("saves the chat's draft of one action with the chat's usage feature", async () => {
    const supabase = seeded();

    await service().createDraftFromAction(EVENT, 'user-1', [pools], {
      source: 'chat',
      conversationId: 'chat-1',
      summary: 'Four pools.',
      tournamentId: TOURNAMENT,
    });

    expect(rowsTo(supabase, DRAFTS)).toEqual([
      {
        op: 'insert',
        row: {
          event_id: EVENT,
          tournament_id: TOURNAMENT,
          actor_user_id: 'user-1',
          draft_type: 'pool_plan',
          prompt: 'Four pools.',
          summary: 'Four pools.',
          proposed_actions_json: [pools],
          validation_state: { ok: true, warnings: [], errors: [] },
          status: 'ready',
          error: null,
          ai_usage_feature: 'organizer_chat',
          source: 'chat',
          conversation_id: 'chat-1',
        },
      },
    ]);
    expect(rowsTo(supabase, 'audit_log')).toEqual([
      {
        op: 'insert',
        row: {
          actor_user_id: 'user-1',
          action: 'event.ai_assistant_draft_created',
          entity_type: 'organizer_ai_assistant_draft',
          entity_id: 'draft-1',
          payload_json: {
            draftType: 'pool_plan',
            status: 'ready',
            source: 'chat',
            conversationId: 'chat-1',
          },
        },
      },
    ]);
  });

  it("saves Claude's draft of several actions, with no usage feature of ours and the audit extra", async () => {
    const supabase = seeded();

    await service().createDraftFromAction(EVENT, 'user-1', placements, {
      source: 'mcp',
      auditExtra: { via: 'mcp', clientId: 'client-1', clientName: 'Claude' },
    });

    expect(rowsTo(supabase, DRAFTS)).toEqual([
      {
        op: 'insert',
        row: {
          event_id: EVENT,
          tournament_id: null,
          actor_user_id: 'user-1',
          draft_type: 'schedule_grid',
          prompt: 'Claude proposed: schedule_match',
          summary: null,
          proposed_actions_json: placements,
          validation_state: { ok: true, warnings: [], errors: [] },
          status: 'ready',
          error: null,
          source: 'mcp',
          conversation_id: null,
        },
      },
    ]);
    expect(rowsTo(supabase, 'audit_log')).toEqual([
      {
        op: 'insert',
        row: {
          actor_user_id: 'user-1',
          action: 'event.ai_assistant_draft_created',
          entity_type: 'organizer_ai_assistant_draft',
          entity_id: 'draft-1',
          payload_json: {
            via: 'mcp',
            clientId: 'client-1',
            clientName: 'Claude',
            draftType: 'schedule_grid',
            status: 'ready',
            source: 'mcp',
            conversationId: null,
          },
        },
      },
    ]);
  });

  it("stores the caller's own prompt when it names one", async () => {
    const supabase = seeded();

    await service().createDraftFromAction(EVENT, 'user-1', [pools], {
      source: 'mcp',
      prompt: 'Make 4 Pools in the Longsword Open',
    });

    const [write] = rowsTo(supabase, DRAFTS);
    expect((write?.row as Record<string, unknown>)['prompt']).toBe(
      'Make 4 Pools in the Longsword Open',
    );
  });

  it('refuses actions of two kinds before it reads a Tournament or saves anything', async () => {
    const supabase = seeded();

    await expect(
      service().createDraftFromAction(EVENT, 'user-1', [pools, placements[0]!], { source: 'mcp' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'A draft holds actions of one kind, not generate_pools, schedule_match',
    });

    expect(queriedTables(supabase.from)).toEqual(['events']);
    expect(supabase.writes).toEqual([]);
  });

  it('refuses an empty list of actions', async () => {
    const supabase = seeded();

    await expect(
      service().createDraftFromAction(EVENT, 'user-1', [], { source: 'mcp' }),
    ).rejects.toMatchObject({ status: 400, message: 'A draft needs at least one action' });

    expect(queriedTables(supabase.from)).toEqual(['events']);
    expect(supabase.writes).toEqual([]);
  });
});
