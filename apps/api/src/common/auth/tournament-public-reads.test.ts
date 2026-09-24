/**
 * The public reads keyed by a Tournament id: pool standings, Swiss standings,
 * Swiss rounds and the three stats reads (rulings 81-83).
 *
 * Until 2026-09-24 all six answered anyone for any Tournament. The public slug
 * pages hand out a draft Tournament's id, so its standings, rounds and stats
 * were one request away. Now a Tournament hidden from the caller (a DRAFT
 * Event, or a Tournament not published, running or completed) answers exactly
 * as an unknown id does: the services' own 404 for the two standings, the
 * empty answer for the rounds and the stats. A member of the Event's club and
 * an ACTIVE staff session of the same Event still read them.
 *
 * The gate sits in the controllers: other services call these service methods
 * for their own reasons (seeding, placements, the organiser's statistics).
 *
 * The rounds, the stats and every unknown-id answer run the real services over
 * seeded tables; the two standings stub only what a KNOWN id computes.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../testing/supabase-chain';
import { OrganizationsService } from '../../modules/organizations/organizations.service';
import { PoolStandingsController } from '../../modules/pool-standings/pool-standings.controller';
import { PoolStandingsService } from '../../modules/pool-standings/pool-standings.service';
import { StatsController } from '../../modules/stats/stats.controller';
import { StatsService } from '../../modules/stats/stats.service';
import { SwissPublicRoundsService } from '../../modules/swiss/swiss-public-rounds.service';
import { SwissStandingsController } from '../../modules/swiss/swiss-standings.controller';
import { SwissStandingsService } from '../../modules/swiss/swiss-standings.service';

const EVENT_OPEN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVENT_DRAFT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
/** A published Event whose own Tournaments are not: EVENT_OPEN's staff are strangers here. */
const EVENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RUNNING = '11111111-1111-4111-8111-111111111111';
const PUBLISHED = '22222222-2222-4222-8222-222222222222';
const COMPLETED = '33333333-3333-4333-8333-333333333333';
const IN_DRAFT_EVENT = '44444444-4444-4444-8444-444444444444';
const DRAFT = '55555555-5555-4555-8555-555555555555';
const ARCHIVED = '66666666-6666-4666-8666-666666666666';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const VISIBLE = [RUNNING, PUBLISHED, COMPLETED];
const HIDDEN = [IN_DRAFT_EVENT, DRAFT, ARCHIVED];
const KNOWN = new Set([...VISIBLE, ...HIDDEN]);

const events = {
  [EVENT_OPEN]: { id: EVENT_OPEN, status: 'published', organization_id: 'org-a' },
  [EVENT_DRAFT]: { id: EVENT_DRAFT, status: 'draft', organization_id: 'org-a' },
  [EVENT_B]: { id: EVENT_B, status: 'published', organization_id: 'org-a' },
};

function tournament(id: string, status: string, eventId: keyof typeof events) {
  return {
    id,
    status,
    ruleset_code: 'TF_v1',
    ruleset_version: '1.0.0',
    // Its own side colours, so the rounds answer names the row it came from.
    scoring_config_json: { display: { sideColors: { red: 'black', blue: 'white' } } },
    events: events[eventId],
  };
}

type Caller = { user?: string; staff?: { staffId: string; eventId: string } };

let db: ReturnType<typeof mockSupabase>;
let pool: PoolStandingsController;
let swiss: SwissStandingsController;
let stats: StatsController;

/** Every table but `tournaments`. No Tournament here has a Swiss phase: the rounds and the Swiss standings then answer from the Tournament row alone. */
const TABLES = {
  phases: { rows: [] },
  matches: {
    rows: [...KNOWN].map((id) => ({
      id: `m-${id}`,
      status: 'completed',
      'phases.tournament_id': id,
    })),
  },
  exchanges: {
    rows: [...KNOWN].map((id) => ({
      id: `x-${id}`,
      voided: false,
      'matches.phases.tournament_id': id,
    })),
  },
  organization_members: {
    rows: [
      { organization_id: 'org-a', user_id: 'u-member', role: 'read_only' },
      { organization_id: 'org-b', user_id: 'u-owner-b', role: 'owner' },
    ],
  },
  event_staff_accounts: {
    rows: [
      { id: 'staff-draft', event_id: EVENT_DRAFT, status: 'active' },
      { id: 'staff-off', event_id: EVENT_DRAFT, status: 'disabled' },
      { id: 'staff-open', event_id: EVENT_OPEN, status: 'active' },
      { id: 'staff-b', event_id: EVENT_B, status: 'active' },
    ],
  },
};

/** The three stats functions answer one fighter for a known Tournament. */
async function statsRpc(fn: string, args: { p_tournament_id: string }) {
  if (!KNOWN.has(args.p_tournament_id)) return { data: [], error: null };
  if (fn === 'tournament_target_value_stats') {
    return {
      data: [{ registration_id: 'r1', person_id: 'p1', point_value: 3, clean_hits: 2 }],
      error: null,
    };
  }
  if (fn === 'fighter_exchange_stats') {
    return { data: [{ registration_id: 'r1', person_id: 'p1', hit_ratio: 1 }], error: null };
  }
  return { data: [], error: null };
}

const rulesets = {
  resolve: async () => ({
    metadata: { hasAfterblow: true, afterblowValuation: 'fixed', afterblowFixedValue: -1 },
  }),
};

/** A known id's standings are stubbed; an unknown one reaches the real service. */
function standingsServices(supabase: unknown) {
  const realPool = new PoolStandingsService(supabase as never, rulesets as never);
  const realSwiss = new SwissStandingsService(supabase as never, rulesets as never);
  return {
    pool: {
      getPoolStandings: (id: string, mode: 'by-pool' | 'overall') =>
        KNOWN.has(id)
          ? Promise.resolve({ tournament: id, mode })
          : realPool.getPoolStandings(id, mode),
    },
    swiss: {
      getSwissStandings: (id: string) =>
        KNOWN.has(id) ? Promise.resolve({ tournament: id }) : realSwiss.getSwissStandings(id),
    },
  };
}

function build(tournaments: Parameters<typeof mockSupabase>[0][string]) {
  db = mockSupabase({ tournaments, ...TABLES });
  const supabase = { service: { from: db.service.from, rpc: statsRpc } };
  const orgs = new OrganizationsService(supabase as never);
  const services = standingsServices(supabase);
  pool = new PoolStandingsController(services.pool as never, supabase as never, orgs);
  swiss = new SwissStandingsController(
    services.swiss as never,
    new SwissPublicRoundsService(supabase as never),
    supabase as never,
    orgs,
  );
  stats = new StatsController(
    new StatsService(supabase as never, rulesets as never),
    supabase as never,
    orgs,
  );
}

beforeEach(() =>
  build({
    rows: [
      tournament(RUNNING, 'running', EVENT_OPEN),
      tournament(PUBLISHED, 'published', EVENT_OPEN),
      tournament(COMPLETED, 'completed', EVENT_OPEN),
      tournament(IN_DRAFT_EVENT, 'running', EVENT_DRAFT),
      tournament(DRAFT, 'draft', EVENT_B),
      tournament(ARCHIVED, 'archived', EVENT_B),
    ],
  }),
);

/** A request as the AuthGuard leaves it: the login wins the identity, the staff cookie is kept beside it. */
function req(caller: Caller = {}) {
  const identity = caller.user
    ? { kind: 'claimed', userId: caller.user, email: null }
    : caller.staff
      ? { kind: 'staff', ...caller.staff }
      : { kind: 'anonymous' };
  return { headers: {}, cookies: {}, identity, staffSession: caller.staff ?? null } as never;
}

/** The answer, or the refusal's status and body, with the id blanked so two ids compare. */
async function answer(call: Promise<unknown>, id: string): Promise<string> {
  const result = await call.then(
    (value) => ({ value }),
    (error: unknown) => {
      if (!(error instanceof HttpException)) throw error;
      return { status: error.getStatus(), refused: error.getResponse() };
    },
  );
  return JSON.stringify(result).replaceAll(id, '<id>');
}

const ROUTES = {
  poolStandings: (id: string, r: never) => pool.get(id, 'overall', r),
  poolStandingsByPool: (id: string, r: never) => pool.get(id, 'by-pool', r),
  swissStandings: (id: string, r: never) => swiss.getStandings(id, r),
  swissRounds: (id: string, r: never) => swiss.getRounds(id, r),
  statsOverview: (id: string, r: never) => stats.overview(id, r),
  statsFighters: (id: string, r: never) => stats.fighters(id, r),
  statsTargetValues: (id: string, r: never) => stats.targetValues(id, r),
};

/** What each route answers an unknown id — the real services' own answers. */
const UNKNOWN_ANSWER: Record<keyof typeof ROUTES, unknown> = {
  poolStandings: {
    status: 404,
    refused: { message: 'Tournament <id> not found', error: 'Not Found', statusCode: 404 },
  },
  poolStandingsByPool: {
    status: 404,
    refused: { message: 'Tournament <id> not found', error: 'Not Found', statusCode: 404 },
  },
  swissStandings: {
    status: 404,
    refused: { message: 'Tournament <id> not found', error: 'Not Found', statusCode: 404 },
  },
  swissRounds: {
    value: {
      phaseId: null,
      roundCount: 0,
      roundsCompleted: 0,
      finalized: null,
      sideColors: { red: 'red', blue: 'blue' },
      rounds: [],
    },
  },
  statsOverview: {
    value: {
      tournamentId: '<id>',
      participantCount: 0,
      matchCount: 0,
      exchangeCount: 0,
      doublesCount: 0,
      doublesPercent: 0,
      clubCount: 0,
      topFighters: [],
    },
  },
  statsFighters: { value: { fighters: [], afterblow: { valuation: null, fixedValue: null } } },
  statsTargetValues: { value: { maxValue: null, distribution: [], hunters: [] } },
};

const STRANGERS: Caller[] = [
  {},
  { user: 'u-stranger' },
  { user: 'u-owner-b' },
  { staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
  { staff: { staffId: 'staff-off', eventId: EVENT_DRAFT } },
  { user: 'u-stranger', staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
];

/** The active staff session of the hidden Tournament's own Event. */
const staffOf = (id: string) =>
  id === IN_DRAFT_EVENT
    ? { staffId: 'staff-draft', eventId: EVENT_DRAFT }
    : { staffId: 'staff-b', eventId: EVENT_B };

describe.each(Object.keys(ROUTES) as Array<keyof typeof ROUTES>)('%s (rulings 81-83)', (route) => {
  const call = (id: string, caller?: Caller) => answer(ROUTES[route](id, req(caller)), id);

  it("answers an unknown Tournament with the service's own unknown answer", async () => {
    expect(await call(UNKNOWN)).toBe(JSON.stringify(UNKNOWN_ANSWER[route]));
  });

  it('shows a published, running or completed Tournament to anyone, signed out included', async () => {
    const unknown = await call(UNKNOWN);
    for (const id of VISIBLE) {
      expect(await call(id), id).not.toBe(unknown);
      expect(await call(id, { user: 'u-stranger' }), id).toBe(await call(id));
    }
  });

  it('answers a hidden Tournament to outsiders exactly as an unknown one', async () => {
    const unknown = await call(UNKNOWN);
    for (const id of HIDDEN) {
      for (const caller of STRANGERS) {
        expect(await call(id, caller), `${id} ${JSON.stringify(caller)}`).toBe(unknown);
      }
    }
  });

  it("shows a hidden Tournament to a club member and to the Event's active staff", async () => {
    const shown = await call(RUNNING);
    for (const id of HIDDEN) {
      for (const caller of [
        { user: 'u-member' },
        { staff: staffOf(id) },
        // The Event's pad, where a stranger once signed in.
        { user: 'u-stranger', staff: staffOf(id) },
      ]) {
        expect(await call(id, caller), `${id} ${JSON.stringify(caller)}`).toBe(shown);
      }
    }
  });

  it("reads the Tournament's status and Event, and a projector's read costs no membership read", async () => {
    await call(RUNNING);
    await call(DRAFT);
    await call(IN_DRAFT_EVENT);
    expect(selectsFor(db.from, 'tournaments')).toContain(
      'status, events!inner(id, status, organization_id, event_kind)',
    );
    expect(queriedTables(db.from)).not.toContain('organization_members');
    expect(queriedTables(db.from)).not.toContain('event_staff_accounts');
  });

  it('fails a failed Tournament read loudly, never as an unknown Tournament', async () => {
    build({ data: null, error: { message: 'connection reset' } });
    await expect(ROUTES[route](RUNNING, req())).rejects.toThrow(
      /^tournament visibility read failed: connection reset$/,
    );
    await expect(ROUTES[route](RUNNING, req())).rejects.not.toBeInstanceOf(HttpException);
  });
});
