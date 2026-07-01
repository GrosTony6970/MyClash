import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PeopleContextService } from './people-context.service';

type MockResult = { data: unknown; error: unknown };

function makeChain(result: MockResult) {
  const chain: Record<string, unknown> = {
    then: (resolve: (v: MockResult) => unknown) => Promise.resolve(result).then(resolve),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const key of ['select', 'eq', 'neq', 'in', 'or', 'order', 'limit']) {
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

describe('PeopleContextService.enrich', () => {
  beforeEach(() => vi.clearAllMocks());

  it('composes tournament, pool, license, rank, next match and follow state', async () => {
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
    // next matches
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
    // tournaments
    queue('tournaments', {
      data: [{ id: 't-1', name: 'Longsword Open', slug: 'longsword-open' }],
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
      follows as never,
    );
    const [ctx] = await svc.enrich(['gp-1'], 'user-1');

    expect(ctx).toMatchObject({
      globalPersonId: 'gp-1',
      displayName: 'Alex Goches',
      clubName: 'BEC Escrime',
      license: '123',
      isFollowing: true,
      tournament: { id: 't-1', name: 'Longsword Open', slug: 'longsword-open' },
      poolName: 'Pool A',
      rank: 2,
      nextMatch: {
        label: 'M12',
        scheduledAt: '2026-07-10T10:00:00Z',
        opponentName: 'Bob Smith',
        poolName: 'Pool A',
        liceName: 'Piste 3',
      },
    });
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
      follows as never,
    );
    const [ctx] = await svc.enrich(['gp-2'], 'user-1');

    expect(ctx).toMatchObject({
      globalPersonId: 'gp-2',
      displayName: 'No Event',
      tournament: null,
      poolName: null,
      rank: null,
      nextMatch: null,
    });
    expect(poolStandings.getPoolStandings).not.toHaveBeenCalled();
  });
});
