import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizerAIAssistantService } from './organizer-ai-assistant.service';

const mockSupabaseFrom = vi.fn();
const mockGenerateWithCap = vi.fn();
const mockAssertOrgRole = vi.fn();
const mockCreateTournament = vi.fn();
const mockGeneratePools = vi.fn();
const mockGenerateBracket = vi.fn();

const supabase = { service: { from: mockSupabaseFrom } };
const aiUsage = { generateWithCap: mockGenerateWithCap };
const orgs = { assertOrgRole: mockAssertOrgRole };
const events = { createTournament: mockCreateTournament };
const phases = {
  generatePools: mockGeneratePools,
  generateBracket: mockGenerateBracket,
};

function chain(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const base = {
    select: vi.fn(() => base),
    eq: vi.fn(() => base),
    in: vi.fn(() => base),
    order: vi.fn(() => base),
    limit: vi.fn(() => base),
    insert: vi.fn(() => base),
    update: vi.fn(() => base),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
  };
  return base;
}

/** The `schedule_match` action writes a match time, so it owes the queued
 *  "your fight starts soon" a refresh. */
const matchAlerts = { refresh: vi.fn().mockResolvedValue(undefined) };

function service() {
  return new OrganizerAIAssistantService(
    supabase as never,
    aiUsage as never,
    orgs as never,
    events as never,
    phases as never,
    matchAlerts as never,
  );
}

describe('OrganizerAIAssistantService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertOrgRole.mockResolvedValue(undefined);
    mockGenerateWithCap.mockResolvedValue({
      text: JSON.stringify({
        summary: 'Use four balanced pools.',
        actions: [{ kind: 'generate_pools', tournamentId: 't-1', targetSize: 8 }],
        warnings: [],
      }),
      inputTokens: 20,
      outputTokens: 40,
      costEur: 0.01,
    });
  });

  it('rejects draft creation when organizer BYOK is missing', async () => {
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'events') {
        return chain({ data: { id: 'event-1', organization_id: 'org-1' }, error: null });
      }
      if (table === 'organization_ai_settings') return chain({ data: null, error: null });
      return chain();
    });

    await expect(
      service().createDraft('event-1', 'user-1', {
        draftType: 'pool_plan',
        prompt: 'Make good pools',
        tournamentId: 't-1',
      }),
    ).rejects.toThrow(NotFoundException);

    expect(mockSupabaseFrom).not.toHaveBeenCalledWith('platform_ai_settings');
  });

  it('persists failed drafts when AI returns invalid JSON', async () => {
    const inserted: Record<string, unknown>[] = [];
    mockGenerateWithCap.mockResolvedValueOnce({
      text: 'not json',
      inputTokens: 5,
      outputTokens: 2,
      costEur: 0.001,
    });
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'events') {
        return chain({ data: { id: 'event-1', organization_id: 'org-1' }, error: null });
      }
      if (table === 'organization_ai_settings') {
        return chain({ data: { provider: 'openai' }, error: null });
      }
      if (table === 'organization_ai_keys') {
        return chain({ data: { id: 'k1' }, error: null });
      }
      if (table === 'organizer_ai_assistant_drafts') {
        const c = chain({
          data: {
            id: 'draft-1',
            status: 'failed',
            validation_state: { ok: false },
          },
          error: null,
        });
        c.insert.mockImplementation(((row: Record<string, unknown>) => {
          inserted.push(row);
          return c;
        }) as never);
        return c;
      }
      if (table === 'audit_log') return chain();
      return chain();
    });

    const draft = await service().createDraft('event-1', 'user-1', {
      draftType: 'pool_plan',
      prompt: 'Make good pools',
      tournamentId: 't-1',
    });

    expect(draft.status).toBe('failed');
    expect(inserted[0]?.['status']).toBe('failed');
    expect(inserted[0]?.['proposed_actions_json']).toEqual([]);
  });

  it('creates a validated draft through org AI usage logging', async () => {
    const inserted: Record<string, unknown>[] = [];
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'events') {
        return chain({ data: { id: 'event-1', organization_id: 'org-1' }, error: null });
      }
      if (table === 'organization_ai_settings') {
        return chain({ data: { provider: 'openai' }, error: null });
      }
      if (table === 'organization_ai_keys') {
        return chain({ data: { id: 'k1' }, error: null });
      }
      if (table === 'organizer_ai_assistant_drafts') {
        const c = chain({
          data: {
            id: 'draft-1',
            draft_type: 'pool_plan',
            status: 'ready',
            validation_state: { ok: true, warnings: [] },
          },
          error: null,
        });
        c.insert.mockImplementation(((row: Record<string, unknown>) => {
          inserted.push(row);
          return c;
        }) as never);
        return c;
      }
      if (table === 'audit_log') return chain();
      return chain();
    });

    await service().createDraft('event-1', 'user-1', {
      draftType: 'pool_plan',
      prompt: 'Make good pools',
      tournamentId: 't-1',
    });

    expect(mockGenerateWithCap).toHaveBeenCalledWith(
      'org-1',
      'event-1',
      'organizer_tournament_assistant',
      expect.objectContaining({ temperature: 0.2 }),
    );
    expect(inserted[0]?.['proposed_actions_json']).toEqual([
      { kind: 'generate_pools', tournamentId: 't-1', targetSize: 8 },
    ]);
    expect(mockSupabaseFrom).not.toHaveBeenCalledWith('platform_ai_settings');
  });

  it('accepts a draft whose JSON arrives inside a markdown code fence', async () => {
    // The production defect this guards. The prompt says "strict JSON only" and
    // the model fenced it anyway, so a bare JSON.parse threw
    // `Unexpected token '`'` and EVERY draft landed `failed` with no actions —
    // the whole draft→review→apply feature produced nothing appliable. Caught
    // by inspecting a real draft from `31-ai-generation`, not by a unit test,
    // because a mock only ever returns the shape its author imagined.
    const inserted: Record<string, unknown>[] = [];
    mockGenerateWithCap.mockResolvedValueOnce({
      text:
        '```json\n' +
        JSON.stringify({
          summary: 'Four pools of eight',
          actions: [{ kind: 'generate_pools', tournamentId: 't-1', targetSize: 8 }],
          warnings: [],
        }) +
        '\n```',
      inputTokens: 5,
      outputTokens: 2,
      costEur: 0.001,
    });
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'events') {
        return chain({ data: { id: 'event-1', organization_id: 'org-1' }, error: null });
      }
      if (table === 'organization_ai_settings') {
        return chain({ data: { provider: 'openai' }, error: null });
      }
      if (table === 'organization_ai_keys') return chain({ data: { id: 'k1' }, error: null });
      if (table === 'organizer_ai_assistant_drafts') {
        const c = chain({
          data: { id: 'draft-1', status: 'ready', validation_state: { ok: true, warnings: [] } },
          error: null,
        });
        c.insert.mockImplementation(((row: Record<string, unknown>) => {
          inserted.push(row);
          return c;
        }) as never);
        return c;
      }
      return chain();
    });

    const draft = await service().createDraft('event-1', 'user-1', {
      draftType: 'pool_plan',
      prompt: 'Make good pools',
      tournamentId: 't-1',
    });

    expect(draft.status).toBe('ready');
    expect(inserted[0]?.['status']).toBe('ready');
    expect(inserted[0]?.['proposed_actions_json']).toEqual([
      { kind: 'generate_pools', tournamentId: 't-1', targetSize: 8 },
    ]);
  });

  it('applies a tournament_config draft through EventsService', async () => {
    mockCreateTournament.mockResolvedValue({ id: 't-created' });
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'organizer_ai_assistant_drafts') {
        const c = chain({
          data: {
            id: 'draft-1',
            event_id: 'event-1',
            actor_user_id: 'user-1',
            draft_type: 'tournament_config',
            status: 'ready',
            proposed_actions_json: [
              {
                kind: 'create_tournament',
                name: 'Longsword Open',
                slug: 'longsword-open',
                weapon: 'longsword',
                category: 'open',
                rulesetCode: 'TF_v1',
              },
            ],
            events: { organization_id: 'org-1' },
          },
          error: null,
        });
        return c;
      }
      if (table === 'audit_log') return chain();
      return chain();
    });

    const result = await service().applyDraft('event-1', 'draft-1', 'user-1');

    expect(mockCreateTournament).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({ name: 'Longsword Open', slug: 'longsword-open' }),
      'user-1',
    );
    expect(result.appliedResults).toEqual([
      { kind: 'create_tournament', result: { id: 't-created' } },
    ]);
  });

  it('never lets a draft discard scored results, however it asks', async () => {
    // Every other field in the generate_pools mapper is plumbed straight from
    // the model's output, because the worst a wrong one does is make badly
    // shaped pools somebody regenerates. `discardScoredResults` is different:
    // it accepts the PERMANENT deletion of fought bouts and their exchanges.
    //
    // So the action bag here carries it set to true — the shape a confused or
    // prompt-injected model would emit — and the service must still hand the
    // phases layer `false`. Without this, the hardcoded literal is one careless
    // spread away from becoming plumbing, and the failure mode is a model
    // deleting results with no human in the loop.
    mockGeneratePools.mockResolvedValue({ poolCount: 2 });
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'organizer_ai_assistant_drafts') {
        return chain({
          data: {
            id: 'draft-1',
            event_id: 'event-1',
            actor_user_id: 'user-1',
            draft_type: 'pool_plan',
            status: 'ready',
            proposed_actions_json: [
              {
                kind: 'generate_pools',
                tournamentId: '11111111-1111-4111-8111-111111111111',
                targetSize: 8,
                force: true,
                discardScoredResults: true,
              },
            ],
            events: { organization_id: 'org-1' },
          },
          error: null,
        });
      }
      if (table === 'tournaments') {
        return chain({
          data: { id: '11111111-1111-4111-8111-111111111111', event_id: 'event-1' },
          error: null,
        });
      }
      return chain();
    });

    await service().applyDraft('event-1', 'draft-1', 'user-1');

    expect(mockGeneratePools).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ discardScoredResults: false }),
      true,
      'user-1',
    );
  });

  it('rejects unsafe draft action shapes before apply', async () => {
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'organizer_ai_assistant_drafts') {
        return chain({
          data: {
            id: 'draft-1',
            event_id: 'event-1',
            draft_type: 'schedule_grid',
            status: 'ready',
            proposed_actions_json: [{ kind: 'schedule_match', matchId: '', liceId: 'l-1' }],
            events: { organization_id: 'org-1' },
          },
          error: null,
        });
      }
      return chain();
    });

    await expect(service().applyDraft('event-1', 'draft-1', 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });
});
