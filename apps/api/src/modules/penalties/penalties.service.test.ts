import { describe, expect, it, vi } from 'vitest';
import { PenaltiesService } from './penalties.service';

describe('PenaltiesService', () => {
  it('returns an existing penalty when clientUuid was already recorded', async () => {
    const existing = { id: 'penalty-1', client_uuid: 'client-1' };
    const supabase = fakeSupabase({
      match_penalties: { maybeSingle: existing },
      matches: {
        maybeSingle: {
          id: 'match-1',
          red_registration_id: 'reg-red',
          blue_registration_id: 'reg-blue',
          phase_id: 'phase-1',
        },
      },
      phases: { maybeSingle: { id: 'phase-1', tournament_id: 'tournament-1' } },
      tournaments: {
        maybeSingle: { id: 'tournament-1', event_id: 'event-1', penalty_ruleset_id: null },
      },
      events: {
        maybeSingle: { id: 'event-1', organization_id: 'org-1', penalty_ruleset_id: null },
      },
    });
    const service = new PenaltiesService(
      supabase as never,
      { recomputeMatchScore: vi.fn() } as never,
    );

    await expect(
      service.createPenalty(
        'match-1',
        {
          clientUuid: 'client-1',
          sequence: 1,
          registrationId: 'reg-red',
          directCard: 'red',
          reason: 'direct referee decision',
          occurredAt: '2026-05-05T10:00:00.000Z',
        },
        { userId: 'scorekeeper-1' },
      ),
    ).resolves.toBe(existing);
  });

  it('records a direct red card with a -1 score delta and recomputes the match', async () => {
    const recomputeMatchScore = vi.fn().mockResolvedValue({ redScore: -1, blueScore: 0 });
    const supabase = fakeSupabase({
      match_penalties: { maybeSingle: null, insert: { id: 'penalty-1', card: 'red' } },
      matches: {
        maybeSingle: {
          id: 'match-1',
          red_registration_id: 'reg-red',
          blue_registration_id: 'reg-blue',
          phase_id: 'phase-1',
        },
      },
      phases: { maybeSingle: { id: 'phase-1', tournament_id: 'tournament-1' } },
      tournaments: {
        maybeSingle: { id: 'tournament-1', event_id: 'event-1', penalty_ruleset_id: null },
      },
      events: {
        maybeSingle: { id: 'event-1', organization_id: 'org-1', penalty_ruleset_id: null },
      },
    });
    const service = new PenaltiesService(supabase as never, { recomputeMatchScore } as never);

    const result = await service.createPenalty(
      'match-1',
      {
        clientUuid: 'client-1',
        sequence: 1,
        registrationId: 'reg-red',
        directCard: 'red',
        reason: 'direct referee decision',
        occurredAt: '2026-05-05T10:00:00.000Z',
      },
      { userId: 'scorekeeper-1' },
    );

    expect(result).toMatchObject({ id: 'penalty-1', card: 'red' });
    expect(supabase.inserted.match_penalties?.[0]).toMatchObject({
      card: 'red',
      score_delta: -1,
      causes_match_forfeit: false,
      source: 'direct',
    });
    expect(recomputeMatchScore).toHaveBeenCalledWith('match-1');
  });

  it('black-card penalties complete the current match for the opponent', async () => {
    const supabase = fakeSupabase({
      match_penalties: {
        maybeSingle: null,
        insert: { id: 'penalty-1', card: 'black' },
        select: [],
      },
      matches: {
        maybeSingle: {
          id: 'match-1',
          red_registration_id: 'reg-red',
          blue_registration_id: 'reg-blue',
          phase_id: 'phase-1',
        },
      },
      phases: { maybeSingle: { id: 'phase-1', tournament_id: 'tournament-1' } },
      tournaments: {
        maybeSingle: { id: 'tournament-1', event_id: 'event-1', penalty_ruleset_id: null },
      },
      events: {
        maybeSingle: { id: 'event-1', organization_id: 'org-1', penalty_ruleset_id: null },
      },
    });
    const service = new PenaltiesService(
      supabase as never,
      { recomputeMatchScore: vi.fn() } as never,
    );

    await service.createPenalty(
      'match-1',
      {
        clientUuid: 'client-1',
        sequence: 1,
        registrationId: 'reg-red',
        directCard: 'black',
        reason: 'dangerous action',
        occurredAt: '2026-05-05T10:00:00.000Z',
      },
      { userId: 'scorekeeper-1' },
    );

    expect(supabase.updated.matches?.[0]).toMatchObject({
      status: 'completed',
      winner_registration_id: 'reg-blue',
    });
  });

  it('creates a pending tournament review after a second black card', async () => {
    const supabase = fakeSupabase({
      match_penalties: {
        maybeSingle: null,
        insert: { id: 'penalty-2', card: 'black' },
        select: [{ id: 'penalty-1' }, { id: 'penalty-2' }],
      },
      matches: {
        maybeSingle: {
          id: 'match-2',
          red_registration_id: 'reg-red',
          blue_registration_id: 'reg-blue',
          phase_id: 'phase-1',
        },
      },
      phases: { maybeSingle: { id: 'phase-1', tournament_id: 'tournament-1' } },
      tournaments: {
        maybeSingle: { id: 'tournament-1', event_id: 'event-1', penalty_ruleset_id: null },
      },
      events: {
        maybeSingle: { id: 'event-1', organization_id: 'org-1', penalty_ruleset_id: null },
      },
      tournament_penalty_reviews: { upsert: { id: 'review-1', status: 'pending' } },
    });
    const service = new PenaltiesService(
      supabase as never,
      { recomputeMatchScore: vi.fn() } as never,
    );

    await service.createPenalty(
      'match-2',
      {
        clientUuid: 'client-2',
        sequence: 2,
        registrationId: 'reg-red',
        directCard: 'black',
        reason: 'second black card',
        occurredAt: '2026-05-05T10:10:00.000Z',
      },
      { userId: 'scorekeeper-1' },
    );

    expect(supabase.upserted.tournament_penalty_reviews?.[0]).toMatchObject({
      tournament_id: 'tournament-1',
      registration_id: 'reg-red',
      review_type: 'second_black_card',
      status: 'pending',
      black_card_count: 2,
    });
  });
});

type TableState = Record<
  string,
  {
    maybeSingle?: unknown;
    single?: unknown;
    select?: unknown[];
    insert?: unknown;
    update?: unknown;
    upsert?: unknown;
  }
>;

function fakeSupabase(state: TableState) {
  const inserted: Record<string, unknown[]> = {};
  const updated: Record<string, unknown[]> = {};
  const upserted: Record<string, unknown[]> = {};

  function chain(table: string) {
    const tableState = state[table] ?? {};
    const api = {
      select: vi.fn(() => api),
      eq: vi.fn(() => api),
      in: vi.fn(() => api),
      is: vi.fn(() => api),
      order: vi.fn(() => Promise.resolve({ data: tableState.select ?? [], error: null })),
      maybeSingle: vi.fn(() =>
        Promise.resolve({ data: tableState.maybeSingle ?? null, error: null }),
      ),
      single: vi.fn(() =>
        Promise.resolve({
          data:
            tableState.single ??
            tableState.insert ??
            tableState.update ??
            tableState.upsert ??
            null,
          error: null,
        }),
      ),
      insert: vi.fn((row: unknown) => {
        inserted[table] = [...(inserted[table] ?? []), row];
        return api;
      }),
      update: vi.fn((row: unknown) => {
        updated[table] = [...(updated[table] ?? []), row];
        return api;
      }),
      upsert: vi.fn((row: unknown) => {
        upserted[table] = [...(upserted[table] ?? []), row];
        return api;
      }),
    };
    return api;
  }

  return {
    inserted,
    updated,
    upserted,
    service: {
      from: vi.fn((table: string) => chain(table)),
    },
  };
}
