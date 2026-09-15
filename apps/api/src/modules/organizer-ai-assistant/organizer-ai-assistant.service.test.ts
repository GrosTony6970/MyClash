import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  chain,
  mockGenerateWithCap,
  mockSupabaseFrom,
  resetHarness,
  service,
} from './organizer-ai-assistant.harness';

/** Creating a draft. Applying one is in organizer-ai-assistant.apply-draft.test.ts. */
describe('OrganizerAIAssistantService.createDraft', () => {
  beforeEach(resetHarness);

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
    });

    expect(draft.status).toBe('ready');
    expect(inserted[0]?.['status']).toBe('ready');
    expect(inserted[0]?.['proposed_actions_json']).toEqual([
      { kind: 'generate_pools', tournamentId: 't-1', targetSize: 8 },
    ]);
  });
});
