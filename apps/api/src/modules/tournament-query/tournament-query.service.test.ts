import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TournamentQueryService } from './tournament-query.service';
import type { TournamentQueryToolsService } from './tournament-query.tools.service';

const tournamentId = '00000000-0000-4000-8000-000000000001';
const eventId = '00000000-0000-4000-8000-000000000002';
const orgId = '00000000-0000-4000-8000-000000000003';
const userId = '00000000-0000-4000-8000-000000000004';

function makeSupabase() {
  const queries: Array<{ table: string; op: string; payload?: unknown }> = [];
  const from = vi.fn((table: string) => {
    const chain = {
      select: vi.fn(() => chain),
      insert: vi.fn((payload?: unknown) => {
        queries.push({ table, op: 'insert', payload });
        return chain;
      }),
      eq: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => {
        if (table === 'tournaments') {
          return {
            data: {
              id: tournamentId,
              event_id: eventId,
              name: 'Longsword Open',
              weapon: 'Longsword',
              events: { organization_id: orgId },
            },
            error: null,
          };
        }
        if (table === 'tournament_query_settings') return { data: null, error: null };
        if (table === 'organization_ai_settings')
          return { data: { provider: 'openai' }, error: null };
        if (table === 'organization_ai_keys') return { data: { id: 'k1' }, error: null };
        return { data: null, error: null };
      }),
      single: vi.fn(async () => {
        if (table === 'tournament_query_history') return { data: { count: 0 }, error: null };
        return { data: null, error: null };
      }),
    };
    return chain;
  });

  return { service: { from }, queries };
}

describe('TournamentQueryService', () => {
  let supabase: ReturnType<typeof makeSupabase>;
  let organizations: { assertOrgRole: ReturnType<typeof vi.fn> };
  let aiUsage: {
    generateWithCap: ReturnType<typeof vi.fn>;
    getUsageSummary: ReturnType<typeof vi.fn>;
  };
  let tools: TournamentQueryToolsService;

  beforeEach(() => {
    supabase = makeSupabase();
    organizations = { assertOrgRole: vi.fn(async () => undefined) };
    aiUsage = {
      generateWithCap: vi.fn(async () => ({
        text: '',
        toolCall: { name: 'rank_fighters', arguments: { metric: 'win_rate', limit: 5 } },
        inputTokens: 100,
        outputTokens: 50,
        costEur: 0.003,
      })),
      getUsageSummary: vi.fn(async () => ({
        totalSpendEur: 0.42,
        cap: 5,
        remainingEur: 4.58,
        callCount: 2,
      })),
    };
    tools = {
      getToolContext: vi.fn(async () => ({
        weapons: ['Longsword'],
        poolIds: [],
        liceNumbers: [1],
        divisions: ['open'],
      })),
      execute: vi.fn(async () => ({
        render_hint: 'table',
        title: 'Top fighters',
        columns: ['Rank', 'Fighter'],
        rows: [{ Rank: 1, Fighter: 'Ada' }],
        metadata: {
          tool_name: 'rank_fighters',
          arguments: { metric: 'win_rate', limit: 5 },
          row_count: 1,
        },
      })),
    } as unknown as TournamentQueryToolsService;
  });

  it('estimates cost without calling the LLM', async () => {
    const service = new TournamentQueryService(
      supabase as never,
      organizations as never,
      aiUsage as never,
      tools,
    );

    const result = await service.estimate(tournamentId, userId, {
      question: 'Top 5 fighters by win rate',
    });

    expect(result.allowed).toBe(true);
    expect(result.estimatedCostEur).toBeGreaterThan(0);
    expect(aiUsage.generateWithCap).not.toHaveBeenCalled();
    expect(organizations.assertOrgRole).toHaveBeenCalledWith(orgId, userId, 'admin');
  });

  it('uses org BYOK/event cap, validates one tool call, persists user history, and returns same-language results', async () => {
    const service = new TournamentQueryService(
      supabase as never,
      organizations as never,
      aiUsage as never,
      tools,
    );

    const result = await service.query(tournamentId, userId, {
      question: 'Quels sont les 5 meilleurs tireurs au taux de victoire ?',
    });

    expect(result.kind).toBe('result');
    expect(result.language).toBe('fr');
    expect(result.toolCalled).toBe('rank_fighters');
    expect(aiUsage.generateWithCap).toHaveBeenCalledWith(
      orgId,
      eventId,
      'natural_language_query',
      expect.objectContaining({ toolChoice: 'required' }),
    );
    expect(supabase.queries.some((query) => query.table === 'tournament_query_history')).toBe(true);
  });

  it('returns a clarification when the LLM tool call is invalid', async () => {
    aiUsage.generateWithCap.mockResolvedValueOnce({
      text: '',
      toolCall: { name: 'rank_fighters', arguments: { metric: 'win_rate', weapon: 'Rapier' } },
      inputTokens: 50,
      outputTokens: 20,
      costEur: 0.001,
    });
    const service = new TournamentQueryService(
      supabase as never,
      organizations as never,
      aiUsage as never,
      tools,
    );

    const result = await service.query(tournamentId, userId, { question: 'Top Rapier fighters' });

    expect(result.kind).toBe('clarification');
  });

  it('rejects unauthorized users, missing BYOK, and empty questions before LLM calls', async () => {
    const service = new TournamentQueryService(
      supabase as never,
      organizations as never,
      aiUsage as never,
      tools,
    );
    organizations.assertOrgRole.mockRejectedValueOnce(new ForbiddenException('no'));
    await expect(service.query(tournamentId, userId, { question: 'Top fighters' })).rejects.toThrow(
      ForbiddenException,
    );

    supabase = makeSupabase();
    supabase.service.from.mockImplementation((table: string) => {
      const chain = makeSupabase().service.from(table);
      if (table === 'organization_ai_keys') {
        chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
      }
      return chain;
    });
    const missingKeyService = new TournamentQueryService(
      supabase as never,
      organizations as never,
      aiUsage as never,
      tools,
    );
    await expect(
      missingKeyService.query(tournamentId, userId, { question: 'Top fighters' }),
    ).rejects.toThrow(NotFoundException);

    await expect(service.query(tournamentId, userId, { question: ' ' })).rejects.toThrow(
      BadRequestException,
    );
    expect(aiUsage.generateWithCap).not.toHaveBeenCalledWith(
      orgId,
      eventId,
      'natural_language_query',
      expect.objectContaining({ user: ' ' }),
    );
  });
});
