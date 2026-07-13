import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PeopleContextService } from './people-context.service';

type MockResult = { data: unknown; error: unknown };

function makeChain(result: MockResult) {
  const chain: Record<string, unknown> = {
    then: (resolve: (v: MockResult) => unknown) => Promise.resolve(result).then(resolve),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const key of ['select', 'eq', 'neq', 'in', 'or', 'order', 'limit', 'not']) {
    chain[key] = vi.fn(() => chain);
  }
  return chain;
}

/** Table-keyed FIFO queue: each from(table) shifts the next queued result. */
function makeSupabase() {
  const queues = new Map<string, MockResult[]>();
  const supabase = {
    service: {
      from: vi.fn((table: string) => {
        const next = (queues.get(table) ?? []).shift() ?? { data: null, error: null };
        return makeChain(next);
      }),
    },
  };
  const queue = (table: string, result: MockResult) => {
    if (!queues.has(table)) queues.set(table, []);
    queues.get(table)!.push(result);
  };
  return { supabase, queue };
}

/** A PhasesService double whose bracket has no slots (final rank stays null). */
function noBracket() {
  return { getTournamentBracket: vi.fn().mockResolvedValue({ slots: [] }) };
}

describe('PeopleContextService.enrich', () => {
  beforeEach(() => vi.clearAllMocks());

  it('composes event, tournament, pool, rank, next match and follow state', async () => {
    const { supabase, queue } = makeSupabase();

    queue('global_persons', {
      data: [
        {
          id: 'gp-1',
          slug: 'alex-goches',
          display_name: 'Alex Goches',
          photo_url: null,
          country_code: 'FR',
          hema_ratings_id: '123',
          clubs: { name: 'BEC Escrime' },
        },
      ],
      error: null,
    });
    // active event-scoped persons
    queue('persons', {
      data: [
        {
          id: 'p-1',
          global_person_id: 'gp-1',
          events: { status: 'in_progress', is_test_event: false },
        },
      ],
      error: null,
    });
    // registrations (regData)
    queue('registrations', {
      data: [{ id: 'r-1', person_id: 'p-1', tournament_id: 't-1', status: 'registered' }],
      error: null,
    });
    // fights (scheduled → next match)
    queue('matches', {
      data: [
        {
          id: 'm-1',
          match_number_label: 'M12',
          status: 'scheduled',
          scheduled_at: '2026-07-10T10:00:00Z',
          red_registration_id: 'r-1',
          blue_registration_id: 'r-2',
          pools: { name: 'Pool A' },
          lices: { name: 'Piste 3' },
          phases: { visibility_status: 'published' },
        },
      ],
      error: null,
    });
    // opponent name resolution (registrations, 2nd call)
    queue('registrations', {
      data: [
        {
          id: 'r-2',
          persons: {
            given_name: 'Bob',
            family_name: 'Smith',
            global_persons: { display_name: 'Bob Smith' },
          },
        },
      ],
      error: null,
    });
    // tournaments (with parent event embed)
    queue('tournaments', {
      data: [
        {
          id: 't-1',
          name: 'Longsword Open',
          slug: 'longsword-open',
          events: { id: 'e-1', name: 'Spring Open', slug: 'spring-open' },
        },
      ],
      error: null,
    });
    // pool_members
    queue('pool_members', {
      data: [{ registration_id: 'r-1', pools: { name: 'Pool A' } }],
      error: null,
    });

    const follows = {
      filterFollowedGlobalPersons: vi.fn().mockResolvedValue(new Set(['gp-1'])),
    };
    const poolStandings = {
      getPoolStandings: vi.fn().mockResolvedValue({
        rulesetCode: 'x',
        rulesetVersion: '1',
        columns: [],
        rows: [
          {
            rank: 2,
            registrationId: 'r-1',
            displayName: '',
            club: null,
            status: 'in_progress',
            stats: {},
          },
        ],
      }),
    };

    const svc = new PeopleContextService(
      supabase as never,
      poolStandings as never,
      noBracket() as never,
      follows as never,
    );
    const [ctx] = await svc.enrich(['gp-1'], 'user-1');

    expect(ctx).toMatchObject({
      globalPersonId: 'gp-1',
      displayName: 'Alex Goches',
      clubName: 'BEC Escrime',
      license: '123',
      isFollowing: true,
      event: { id: 'e-1', name: 'Spring Open', slug: 'spring-open' },
      tournament: { id: 't-1', name: 'Longsword Open', slug: 'longsword-open' },
      poolName: 'Pool A',
      rank: 2,
      finalRank: null,
      currentMatch: null,
      nextMatch: {
        kind: 'fight',
        matchId: 'm-1',
        status: 'scheduled',
        label: 'M12',
        scheduledAt: '2026-07-10T10:00:00Z',
        opponentName: 'Bob Smith',
        poolName: 'Pool A',
        liceName: 'Piste 3',
        eventSlug: 'spring-open',
      },
    });
  });

  it('splits a running bout into currentMatch and resolves final rank once decided', async () => {
    const { supabase, queue } = makeSupabase();

    queue('global_persons', {
      data: [
        {
          id: 'gp-3',
          slug: 'cara-vega',
          display_name: 'Cara Vega',
          photo_url: null,
          country_code: null,
          hema_ratings_id: null,
          clubs: null,
        },
      ],
      error: null,
    });
    queue('persons', {
      data: [
        {
          id: 'p-3',
          global_person_id: 'gp-3',
          events: { status: 'in_progress', is_test_event: false },
        },
      ],
      error: null,
    });
    queue('registrations', {
      data: [{ id: 'r-3', person_id: 'p-3', tournament_id: 't-3', status: 'registered' }],
      error: null,
    });
    // One running bout (→ currentMatch) and one scheduled bout (→ nextMatch).
    queue('matches', {
      data: [
        {
          id: 'm-live',
          match_number_label: 'SF-1',
          status: 'running',
          scheduled_at: '2026-07-13T09:00:00Z',
          red_registration_id: 'r-3',
          blue_registration_id: 'r-4',
          pools: null,
          lices: { name: 'Piste 1' },
          phases: { visibility_status: 'published' },
        },
        {
          id: 'm-next',
          match_number_label: 'F-1',
          status: 'scheduled',
          scheduled_at: '2026-07-13T10:00:00Z',
          red_registration_id: 'r-3',
          blue_registration_id: 'r-5',
          pools: null,
          lices: { name: 'Piste 1' },
          phases: { visibility_status: 'published' },
        },
      ],
      error: null,
    });
    // opponent name resolution (r-4 live, r-5 next)
    queue('registrations', {
      data: [
        {
          id: 'r-4',
          persons: {
            given_name: 'Dan',
            family_name: 'Roe',
            global_persons: { display_name: 'Dan Roe' },
          },
        },
        {
          id: 'r-5',
          persons: {
            given_name: 'Eve',
            family_name: 'Lin',
            global_persons: { display_name: 'Eve Lin' },
          },
        },
      ],
      error: null,
    });
    queue('tournaments', {
      data: [
        {
          id: 't-3',
          name: 'Rapier Open',
          slug: 'rapier-open',
          events: { id: 'e-3', name: 'Summer Cup', slug: 'summer-cup' },
        },
      ],
      error: null,
    });
    queue('pool_members', {
      data: [{ registration_id: 'r-3', pools: { name: 'Pool B' } }],
      error: null,
    });

    const follows = { filterFollowedGlobalPersons: vi.fn().mockResolvedValue(new Set(['gp-3'])) };
    const poolStandings = {
      getPoolStandings: vi.fn().mockResolvedValue({
        rulesetCode: 'x',
        rulesetVersion: '1',
        columns: [],
        rows: [
          {
            rank: 1,
            registrationId: 'r-3',
            displayName: 'Cara Vega',
            club: null,
            status: 'completed',
            stats: { score: 9 },
          },
          {
            rank: 2,
            registrationId: 'r-4',
            displayName: 'Dan Roe',
            club: null,
            status: 'completed',
            stats: { score: 6 },
          },
        ],
      }),
    };
    // A decided Final: r-3 beats r-4 → champion.
    const phases = {
      getTournamentBracket: vi.fn().mockResolvedValue({
        slots: [
          {
            id: 's-final',
            round: 1,
            position: 1,
            status: 'completed',
            redRegistrationId: 'r-3',
            blueRegistrationId: 'r-4',
            redFighterName: 'Cara Vega',
            blueFighterName: 'Dan Roe',
            redClubAbbrev: null,
            blueClubAbbrev: null,
            redScore: 5,
            blueScore: 3,
          },
        ],
      }),
    };

    const svc = new PeopleContextService(
      supabase as never,
      poolStandings as never,
      phases as never,
      follows as never,
    );
    const [ctx] = await svc.enrich(['gp-3'], 'user-1');

    expect(ctx).toMatchObject({
      globalPersonId: 'gp-3',
      event: { id: 'e-3', name: 'Summer Cup', slug: 'summer-cup' },
      tournament: { id: 't-3', name: 'Rapier Open', slug: 'rapier-open' },
      rank: 1,
      finalRank: { place: 1, resultKind: 'champion', totalRanked: 2 },
      currentMatch: {
        kind: 'fight',
        matchId: 'm-live',
        status: 'running',
        label: 'SF-1',
        opponentName: 'Dan Roe',
        liceName: 'Piste 1',
        eventSlug: 'summer-cup',
      },
      nextMatch: {
        kind: 'fight',
        matchId: 'm-next',
        status: 'scheduled',
        opponentName: 'Eve Lin',
        eventSlug: 'summer-cup',
      },
    });
  });

  it('surfaces a live refereeing assignment as currentMatch when not competing', async () => {
    const { supabase, queue } = makeSupabase();

    queue('global_persons', {
      data: [
        {
          id: 'gp-4',
          slug: 'ref-only',
          display_name: 'Ref Only',
          photo_url: null,
          country_code: null,
          hema_ratings_id: null,
          clubs: null,
        },
      ],
      error: null,
    });
    // Live refereeing assignment (resolved before the no-registration early return).
    queue('referee_assignments', {
      data: [
        {
          person_id: 'gp-4',
          role: 'skill-9',
          matches: {
            id: 'm-ref',
            status: 'running',
            scheduled_at: '2026-07-13T09:30:00Z',
            match_number_label: 'QF-2',
            lices: { name: 'Piste 2' },
            pools: null,
            phases: {
              visibility_status: 'published',
              tournaments: {
                slug: 'saber-open',
                events: { slug: 'autumn-cup', name: 'Autumn Cup' },
              },
            },
          },
        },
      ],
      error: null,
    });
    queue('referee_skills', {
      data: [{ id: 'skill-9', name: 'Head referee', color: '#ff0000' }],
      error: null,
    });
    // No active registered events → falls through to base + referee currentMatch.
    queue('persons', { data: [], error: null });

    const follows = { filterFollowedGlobalPersons: vi.fn().mockResolvedValue(new Set(['gp-4'])) };
    const poolStandings = { getPoolStandings: vi.fn() };

    const svc = new PeopleContextService(
      supabase as never,
      poolStandings as never,
      noBracket() as never,
      follows as never,
    );
    const [ctx] = await svc.enrich(['gp-4'], 'user-1');

    expect(ctx).toMatchObject({
      globalPersonId: 'gp-4',
      tournament: null,
      currentMatch: {
        kind: 'referee',
        matchId: 'm-ref',
        status: 'running',
        label: 'QF-2',
        skillName: 'Head referee',
        skillColor: '#ff0000',
        liceName: 'Piste 2',
        eventSlug: 'autumn-cup',
        eventName: 'Autumn Cup',
      },
    });
    expect(poolStandings.getPoolStandings).not.toHaveBeenCalled();
  });

  it('returns base identity only when the person has no active events', async () => {
    const { supabase, queue } = makeSupabase();
    queue('global_persons', {
      data: [
        {
          id: 'gp-2',
          slug: 'no-event',
          display_name: 'No Event',
          photo_url: null,
          country_code: null,
          hema_ratings_id: null,
          clubs: null,
        },
      ],
      error: null,
    });
    // Only a completed (terminal) event → filtered out as inactive.
    queue('persons', {
      data: [
        {
          id: 'p-2',
          global_person_id: 'gp-2',
          events: { status: 'completed', is_test_event: false },
        },
      ],
      error: null,
    });

    const follows = { filterFollowedGlobalPersons: vi.fn().mockResolvedValue(new Set()) };
    const poolStandings = { getPoolStandings: vi.fn() };

    const svc = new PeopleContextService(
      supabase as never,
      poolStandings as never,
      noBracket() as never,
      follows as never,
    );
    const [ctx] = await svc.enrich(['gp-2'], 'user-1');

    expect(ctx).toMatchObject({
      globalPersonId: 'gp-2',
      displayName: 'No Event',
      event: null,
      tournament: null,
      poolName: null,
      rank: null,
      finalRank: null,
      lastResult: null,
      currentMatch: null,
      nextMatch: null,
    });
    expect(poolStandings.getPoolStandings).not.toHaveBeenCalled();
  });

  it('shows the most recent completed result for an idle followee (last result)', async () => {
    const { supabase, queue } = makeSupabase();

    queue('global_persons', {
      data: [
        {
          id: 'gp-5',
          slug: 'idle-fighter',
          display_name: 'Idle Fighter',
          photo_url: null,
          country_code: null,
          hema_ratings_id: null,
          clubs: null,
        },
      ],
      error: null,
    });
    // Only a completed event → idle, so the last-result fallback runs.
    queue('persons', {
      data: [
        {
          id: 'p-5',
          global_person_id: 'gp-5',
          events: { status: 'completed', is_test_event: false },
        },
      ],
      error: null,
    });
    // fetchLastResults: the completed registration + its tournament/event.
    queue('registrations', {
      data: [
        {
          id: 'r-5',
          status: 'confirmed',
          persons: { global_person_id: 'gp-5' },
          tournaments: {
            id: 't-5',
            name: 'Winter Cup',
            slug: 'winter-cup',
            weapon: 'Sabre',
            status: 'completed',
            events: {
              name: 'Winter 2025',
              slug: 'winter-2025',
              start_date: '2025-12-01',
              is_test_event: false,
            },
          },
        },
      ],
      error: null,
    });

    const follows = { filterFollowedGlobalPersons: vi.fn().mockResolvedValue(new Set(['gp-5'])) };
    // Pool-only completed tournament → last result falls back to overall pool rank.
    const poolStandings = {
      getPoolStandings: vi.fn().mockResolvedValue({
        rulesetCode: 'x',
        rulesetVersion: '1',
        columns: [],
        rows: [
          {
            rank: 3,
            registrationId: 'r-5',
            displayName: 'Idle Fighter',
            club: null,
            status: 'completed',
            stats: { score: 5 },
          },
        ],
      }),
    };

    const svc = new PeopleContextService(
      supabase as never,
      poolStandings as never,
      noBracket() as never,
      follows as never,
    );
    const [ctx] = await svc.enrich(['gp-5'], 'user-1');

    expect(ctx).toMatchObject({
      globalPersonId: 'gp-5',
      tournament: null,
      currentMatch: null,
      lastResult: {
        eventName: 'Winter 2025',
        eventSlug: 'winter-2025',
        tournamentName: 'Winter Cup',
        tournamentSlug: 'winter-cup',
        weapon: 'Sabre',
        finalRank: { place: 3, resultKind: 'pool' },
      },
    });
  });
});
