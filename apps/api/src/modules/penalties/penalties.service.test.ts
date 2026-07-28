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

  // The scoring pad sends the match-clock position with each penalty so
  // the unified timeline can render match-clock time for penalty rows
  // the same way it does for exchanges.
  it('persists clock_time_ms from dto.clockTimeMs on the inserted penalty', async () => {
    const supabase = fakeSupabase({
      match_penalties: { maybeSingle: null, insert: { id: 'penalty-1', card: 'yellow' } },
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
        clientUuid: 'client-clock',
        sequence: 1,
        registrationId: 'reg-red',
        directCard: 'yellow',
        reason: 'direct referee decision',
        occurredAt: '2026-05-05T10:00:00.000Z',
        clockTimeMs: 45_000,
      },
      { userId: 'scorekeeper-1' },
    );

    expect(supabase.inserted.match_penalties?.[0]).toMatchObject({ clock_time_ms: 45_000 });
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

  // The penalty ruleset's per-card-point columns override the engine's hardcoded
  // score delta, so operators can tune card costs per ruleset.
  it('takes score_delta from the penalty ruleset card-point columns (red = -2)', async () => {
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
        maybeSingle: { id: 'tournament-1', event_id: 'event-1', penalty_ruleset_id: 'pr-1' },
      },
      events: {
        maybeSingle: { id: 'event-1', organization_id: 'org-1', penalty_ruleset_id: null },
      },
      penalty_rulesets: {
        maybeSingle: {
          id: 'pr-1',
          accumulation_scope: 'match',
          yellow_card_points: 0,
          red_card_points: -2,
          black_card_points: 0,
          first_black_card_forfeit: 'match',
          second_black_card_forfeit: 'tournament',
        },
      },
    });
    const service = new PenaltiesService(
      supabase as never,
      { recomputeMatchScore: vi.fn() } as never,
    );

    await service.createPenalty(
      'match-1',
      {
        clientUuid: 'client-rs-delta',
        sequence: 1,
        registrationId: 'reg-red',
        directCard: 'red',
        reason: 'direct referee decision',
        occurredAt: '2026-05-05T10:00:00.000Z',
      },
      { userId: 'scorekeeper-1' },
    );

    expect(supabase.inserted.match_penalties?.[0]).toMatchObject({
      card: 'red',
      score_delta: -2,
      source: 'direct',
    });
  });

  // First black card under a match-scope ruleset completes the match for the
  // opponent but must NOT disqualify the fighter from the tournament.
  it('first black card (match scope) completes the match without a tournament DQ', async () => {
    const supabase = fakeSupabase({
      match_penalties: {
        maybeSingle: null,
        insert: { id: 'penalty-1', card: 'black' },
        select: [{ id: 'penalty-1' }],
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
        maybeSingle: { id: 'tournament-1', event_id: 'event-1', penalty_ruleset_id: 'pr-1' },
      },
      events: {
        maybeSingle: { id: 'event-1', organization_id: 'org-1', penalty_ruleset_id: null },
      },
      penalty_rulesets: {
        maybeSingle: {
          id: 'pr-1',
          accumulation_scope: 'match',
          yellow_card_points: 0,
          red_card_points: -1,
          black_card_points: 0,
          first_black_card_forfeit: 'match',
          second_black_card_forfeit: 'tournament',
        },
      },
    });
    const service = new PenaltiesService(
      supabase as never,
      { recomputeMatchScore: vi.fn() } as never,
    );

    await service.createPenalty(
      'match-1',
      {
        clientUuid: 'client-black-match',
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
    expect(supabase.updated.registrations).toBeUndefined();
  });

  // A scoring-config forfeit override (tournamentState=disqualified) escalates a
  // first black card to tournament scope → the registration is disqualified.
  it('a scoring-config override disqualifies the fighter on a first black card', async () => {
    const supabase = fakeSupabase({
      match_penalties: {
        maybeSingle: null,
        insert: { id: 'penalty-1', card: 'black' },
        select: [{ id: 'penalty-1' }],
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
        maybeSingle: {
          id: 'tournament-1',
          event_id: 'event-1',
          penalty_ruleset_id: 'pr-1',
          ruleset_config: {
            forfeitPolicy: { reasons: { black_card_1: { tournamentState: 'disqualified' } } },
          },
        },
      },
      events: {
        maybeSingle: { id: 'event-1', organization_id: 'org-1', penalty_ruleset_id: null },
      },
      penalty_rulesets: {
        maybeSingle: {
          id: 'pr-1',
          accumulation_scope: 'match',
          yellow_card_points: 0,
          red_card_points: -1,
          black_card_points: 0,
          first_black_card_forfeit: 'match',
          second_black_card_forfeit: 'tournament',
        },
      },
    });
    const service = new PenaltiesService(
      supabase as never,
      { recomputeMatchScore: vi.fn() } as never,
    );

    await service.createPenalty(
      'match-1',
      {
        clientUuid: 'client-black-dq',
        sequence: 1,
        registrationId: 'reg-red',
        directCard: 'black',
        reason: 'dangerous action',
        occurredAt: '2026-05-05T10:00:00.000Z',
      },
      { userId: 'scorekeeper-1' },
    );

    expect(supabase.updated.registrations?.[0]).toMatchObject({ status: 'disqualified' });
  });

  // A ruleset-entry penalty (no directCard) derives its card from the entry's
  // sanctions ladder (first occurrence → sanctions[0]) and records ruleset metadata.
  it('records a ruleset-entry penalty with the card + metadata from the entry', async () => {
    const supabase = fakeSupabase({
      match_penalties: {
        maybeSingle: null,
        insert: { id: 'penalty-1', card: 'yellow' },
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
        maybeSingle: { id: 'tournament-1', event_id: 'event-1', penalty_ruleset_id: 'pr-1' },
      },
      events: {
        maybeSingle: { id: 'event-1', organization_id: 'org-1', penalty_ruleset_id: null },
      },
      penalty_rulesets: {
        maybeSingle: {
          id: 'pr-1',
          accumulation_scope: 'match',
          yellow_card_points: 0,
          red_card_points: -1,
          black_card_points: 0,
          first_black_card_forfeit: 'match',
          second_black_card_forfeit: 'tournament',
        },
      },
      penalty_ruleset_entries: {
        maybeSingle: {
          id: 'entry-1',
          group_number: 3,
          ref_number: '6',
          short_name: 'Non-combativité',
          description: 'Insufficient offensive action',
          sanctions: ['yellow', 'red', 'red', 'black'],
        },
      },
    });
    const service = new PenaltiesService(
      supabase as never,
      { recomputeMatchScore: vi.fn() } as never,
    );

    await service.createPenalty(
      'match-1',
      {
        clientUuid: 'client-entry',
        sequence: 1,
        registrationId: 'reg-red',
        rulesetEntryId: 'entry-1',
        occurredAt: '2026-05-05T10:00:00.000Z',
      },
      { userId: 'scorekeeper-1' },
    );

    expect(supabase.inserted.match_penalties?.[0]).toMatchObject({
      source: 'ruleset',
      card: 'yellow',
      ruleset_entry_id: 'entry-1',
      group_number: 3,
      ref_number: '6',
      short_name: 'Non-combativité',
      score_delta: 0,
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

describe('PenaltiesService.listRulesetCatalogForOrg', () => {
  // A thenable chain supporting `.or().order().order()` (catalog list),
  // `.select().eq().eq().maybeSingle()` (the isSuperAdmin lookup), `.in()`
  // (org-name resolution) and `.eq().is().limit().maybeSingle()` (the built-in
  // baseline the lineage lamps diff against), keyed by table.
  function catalogSupabase(byTable: Record<string, unknown[]>) {
    return {
      service: {
        from: vi.fn((table: string) => {
          const rows = byTable[table] ?? [];
          const chain: Record<string, unknown> = {};
          for (const m of ['select', 'or', 'order', 'in', 'eq', 'is', 'limit']) {
            chain[m] = vi.fn(() => chain);
          }
          // platform_roles (isSuperAdmin) reads null → not a super-admin; with
          // orgs undefined in this harness, assertUserCanManageOrg then passes.
          chain['maybeSingle'] = vi.fn(() => Promise.resolve({ data: null, error: null }));
          chain['then'] = (resolve: (value: unknown) => unknown) =>
            resolve({ data: rows, error: null });
          return chain;
        }),
      },
    };
  }

  it('returns built-in + other orgs’ public rows, attributed by org name, own excluded', async () => {
    const supabase = catalogSupabase({
      penalty_rulesets: [
        {
          id: 'builtin-1',
          code: 'ffamhe_tf_2026',
          version: '2026',
          name: 'FFAMHE TF 2026',
          description: null,
          built_in: true,
          owner_organization_id: null,
          public_visibility: false,
          accumulation_scope: 'tournament',
        },
        {
          id: 'shared-1',
          code: 'ORGX_PEN',
          version: '1.0.0',
          name: 'Org X Penalties',
          description: 'shared',
          built_in: false,
          owner_organization_id: 'org-x',
          public_visibility: true,
          accumulation_scope: 'match',
        },
      ],
      organizations: [{ id: 'org-x', name: 'Org X' }],
    });
    const service = new PenaltiesService(supabase as never);

    const result = await service.listRulesetCatalogForOrg('org-me', 'user-1');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'builtin-1',
      built_in: true,
      owner_organization_name: null,
    });
    expect(result[1]).toMatchObject({ id: 'shared-1', owner_organization_name: 'Org X' });
    const idx = supabase.service.from.mock.calls.findIndex((c) => c[0] === 'penalty_rulesets');
    const penaltyChain = supabase.service.from.mock.results[idx]?.value as {
      or: ReturnType<typeof vi.fn>;
    };
    expect(penaltyChain.or).toHaveBeenCalledWith(
      expect.stringContaining('owner_organization_id.neq.org-me'),
    );
  });

  it('rejects an unauthenticated caller', async () => {
    const supabase = catalogSupabase({});
    const service = new PenaltiesService(supabase as never);
    await expect(service.listRulesetCatalogForOrg('org-me', undefined)).rejects.toThrow();
  });
});

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
