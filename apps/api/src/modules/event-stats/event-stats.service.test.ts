import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventStatsService } from './event-stats.service';

// ── Supabase mock: a universal thenable chain, keyed by table name so tests are
// order-independent (adding a query elsewhere can't desync a fixed once-queue). ─
const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

type Result = { data: unknown; error: unknown };

function makeChain(result: Result) {
  // Thenable so `await chain` works; methods return the chain; maybeSingle/single
  // resolve the same result so a single factory serves awaited + single queries.
  const chain = Object.assign(Promise.resolve(result)) as Promise<Result> & Record<string, unknown>;
  for (const k of ['select', 'eq', 'in', 'is', 'not', 'order']) {
    chain[k] = vi.fn().mockReturnValue(chain);
  }
  chain['maybeSingle'] = vi.fn().mockResolvedValue(result);
  chain['single'] = vi.fn().mockResolvedValue(result);
  return chain;
}

function setupTables(byTable: Record<string, Result>) {
  fromMock.mockImplementation((table: string) =>
    makeChain(byTable[table] ?? { data: [], error: null }),
  );
}

// ── Collaborator mocks ──
function makeOrgs(reject = false) {
  return {
    assertOrgRole: reject
      ? vi.fn().mockRejectedValue(new ForbiddenException('nope'))
      : vi.fn().mockResolvedValue(undefined),
  };
}

const overview = (o: Partial<Record<string, unknown>> = {}) => ({
  tournamentId: 't',
  participantCount: 0,
  matchCount: 0,
  exchangeCount: 0,
  doublesCount: 0,
  doublesPercent: 0,
  clubCount: 0,
  topFighters: [],
  ...o,
});

function makeService(opts: {
  orgs?: ReturnType<typeof makeOrgs>;
  overviewByTournament?: Record<string, ReturnType<typeof overview>>;
  standingsHeaderByTournament?: Record<string, Record<string, unknown>>;
  uniqueCounts?: { uniqueFighters: number; uniqueReferees: number };
  targetRowsByTournament?: Record<string, unknown[]>;
}) {
  const orgs = opts.orgs ?? makeOrgs();
  const events = {
    getPublicTournamentStandings: vi.fn(async (_slug: string, tSlug: string) => ({
      tournament: opts.standingsHeaderByTournament?.[tSlug] ?? {},
      bracketSlots: [],
    })),
    getEventUniqueParticipantCounts: vi.fn(
      async () => opts.uniqueCounts ?? { uniqueFighters: 0, uniqueReferees: 0 },
    ),
  };
  const stats = {
    getTournamentOverview: vi.fn(
      async (id: string) => opts.overviewByTournament?.[id] ?? overview(),
    ),
    getFighterStats: vi.fn(async () => []),
    getTargetValueRows: vi.fn(async (id: string) => opts.targetRowsByTournament?.[id] ?? []),
  };
  const poolStandings = {
    getPoolStandings: vi.fn(async () => ({
      rulesetCode: 'TF_v1',
      rulesetVersion: '1.0.0',
      columns: [],
      rows: [],
    })),
  };
  const service = new EventStatsService(
    mockSupabase as never,
    orgs as never,
    events as never,
    stats as never,
    poolStandings as never,
  );
  return { service, orgs, events, stats, poolStandings };
}

describe('EventStatsService', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('rolls up event doubles% as a WEIGHTED ratio (Σdoubles/Σexchanges), not a mean of percentages', async () => {
    setupTables({
      events: {
        data: { id: 'e1', organization_id: 'org-1', slug: 'evt', name: 'Evt' },
        error: null,
      },
      tournaments: {
        data: [
          {
            id: 't1',
            slug: 't1s',
            name: 'Longsword',
            weapon: 'longsword',
            color: null,
            status: 'completed',
          },
          {
            id: 't2',
            slug: 't2s',
            name: 'Rapier',
            weapon: 'rapier',
            color: null,
            status: 'completed',
          },
        ],
        error: null,
      },
      referee_assignments: { data: [], error: null },
      persons: { data: [{ club_id: 'c1' }, { club_id: 'c2' }, { club_id: 'c1' }], error: null },
    });
    const { service, orgs } = makeService({
      overviewByTournament: {
        t1: overview({
          matchCount: 10,
          exchangeCount: 100,
          doublesCount: 8,
          doublesPercent: 8,
          clubCount: 5,
          participantCount: 20,
        }),
        t2: overview({
          matchCount: 5,
          exchangeCount: 50,
          doublesCount: 7,
          doublesPercent: 14,
          clubCount: 3,
          participantCount: 10,
        }),
      },
      standingsHeaderByTournament: {
        t1s: { participantCount: 22, completedMatchCount: 8 },
        t2s: { participantCount: 12, completedMatchCount: 5 },
      },
      uniqueCounts: { uniqueFighters: 28, uniqueReferees: 6 },
    });

    const res = await service.getEventStatistics('e1', 'user-1');

    // Org guard enforced with scorekeeper role.
    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'scorekeeper');
    // Weighted: 15 doubles / 150 exchanges = 10% (NOT mean(8,14)=11%).
    expect(res.event.doublesPercent).toBe(10);
    expect(res.event.exchangeCount).toBe(150);
    expect(res.event.doublesCount).toBe(15);
    // Completion: 13 completed / 15 total = 87%.
    expect(res.event.matchCount).toBe(15);
    expect(res.event.completedMatchCount).toBe(13);
    expect(res.event.completionPercent).toBe(87);
    // Participants use the tested header count, summed per tournament.
    expect(res.event.participantCount).toBe(34);
    expect(res.event.tournamentCount).toBe(2);
    // Distinct event clubs from persons.club_id union.
    expect(res.event.clubCount).toBe(2);
    // Distinct-people headcounts come from the shared EventsService method.
    expect(res.event.uniqueFighters).toBe(28);
    expect(res.event.uniqueReferees).toBe(6);
    // Per-tournament completion propagates.
    expect(res.tournaments[0]).toMatchObject({
      id: 't1',
      completedMatchCount: 8,
      completionPercent: 80,
    });
  });

  it('rejects a caller lacking the org role (403 propagates from assertOrgRole)', async () => {
    setupTables({
      events: {
        data: { id: 'e1', organization_id: 'org-1', slug: 'evt', name: 'Evt' },
        error: null,
      },
    });
    const { service } = makeService({ orgs: makeOrgs(true) });
    await expect(service.getEventStatistics('e1', 'intruder')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404s tournament detail when the tournament is not in the event', async () => {
    setupTables({
      events: {
        data: { id: 'e1', organization_id: 'org-1', slug: 'evt', name: 'Evt' },
        error: null,
      },
      tournaments: { data: null, error: null }, // assertTournamentInEvent → maybeSingle null
    });
    const { service } = makeService({});
    await expect(service.getTournamentDetail('e1', 't-orphan', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('aggregates event-wide referee workload (matches, roles, cards) per referee', async () => {
    setupTables({
      events: {
        data: { id: 'e1', organization_id: 'org-1', slug: 'evt', name: 'Evt' },
        error: null,
      },
      tournaments: {
        data: [
          {
            id: 't1',
            slug: 't1s',
            name: 'Longsword',
            weapon: 'longsword',
            color: null,
            status: 'completed',
          },
        ],
        error: null,
      },
      referee_assignments: {
        data: [
          {
            match_id: 'm1',
            person_id: 'ref-1',
            role: 'arbitre_declarant',
            matches: { id: 'm1', status: 'completed', duration_active_ms: 60000 },
          },
          {
            match_id: 'm2',
            person_id: 'ref-1',
            role: 'arbitre_declarant',
            matches: { id: 'm2', status: 'completed', duration_active_ms: 120000 },
          },
          {
            match_id: 'm2',
            person_id: 'ref-2',
            role: 'arbitre_assesseur',
            matches: { id: 'm2', status: 'completed', duration_active_ms: 120000 },
          },
          {
            match_id: 'm3',
            person_id: 'ref-1',
            role: 'arbitre_declarant',
            matches: { id: 'm3', status: 'running', duration_active_ms: null },
          }, // not completed → excluded
        ],
        error: null,
      },
      match_penalties: { data: [{ match_id: 'm1', card: 'yellow', voided: false }], error: null },
      global_persons: {
        data: [
          { id: 'ref-1', given_name: 'Jane', family_name: 'Doe' },
          { id: 'ref-2', given_name: 'Max', family_name: 'Roe' },
        ],
        error: null,
      },
      persons: { data: [], error: null },
    });
    const { service } = makeService({
      overviewByTournament: { t1: overview({ matchCount: 3, exchangeCount: 10, doublesCount: 1 }) },
      standingsHeaderByTournament: { t1s: { participantCount: 4, completedMatchCount: 2 } },
    });

    const res = await service.getEventStatistics('e1', 'user-1');

    expect(res.referees).toHaveLength(2);
    const jane = res.referees.find((r) => r.personId === 'ref-1')!;
    expect(jane.name).toBe('Jane Doe');
    expect(jane.matchesReffed).toBe(2); // m1 + m2 (m3 running excluded)
    expect(jane.roles.arbitre_declarant).toBe(2);
    expect(jane.cards.yellow).toBe(1); // declarant on m1
    expect(jane.averageRefereeTimeMs).toBe(90000); // (60000 + 120000) / 2
    // Sorted by matchesReffed desc — Jane (2) before Max (1).
    expect(res.referees[0]!.personId).toBe('ref-1');
  });

  it('builds a per-weapon breakdown (deep-target hunters + point distribution) grouped by weapon', async () => {
    setupTables({
      events: {
        data: { id: 'e1', organization_id: 'org-1', slug: 'evt', name: 'Evt' },
        error: null,
      },
      tournaments: {
        data: [
          {
            id: 't1',
            slug: 't1s',
            name: 'Longsword',
            weapon: 'longsword',
            color: null,
            status: 'completed',
          },
          {
            id: 't2',
            slug: 't2s',
            name: 'Rapier',
            weapon: 'rapier',
            color: null,
            status: 'completed',
          },
          // No weapon declared. Groups under the NULL_KEY sentinel rather than
          // colliding with a real weapon, and sorts last.
          { id: 't3', slug: 't3s', name: 'Open', weapon: null, color: null, status: 'completed' },
        ],
        error: null,
      },
      referee_assignments: { data: [], error: null },
      persons: { data: [], error: null },
    });
    const tv = (o: Record<string, unknown>) => ({
      registrationId: 'r',
      personId: 'p',
      givenName: 'A',
      familyName: 'B',
      clubName: null,
      pointValue: 1,
      cleanHits: 1,
      ...o,
    });
    const { service } = makeService({
      targetRowsByTournament: {
        t1: [
          tv({ personId: 'p1', pointValue: 2, cleanHits: 5 }),
          tv({ personId: 'p2', pointValue: 2, cleanHits: 3 }),
          tv({ personId: 'p1', pointValue: 1, cleanHits: 4 }),
        ],
        t2: [
          tv({ personId: 'p3', pointValue: 3, cleanHits: 6 }),
          tv({ personId: 'p3', pointValue: 1, cleanHits: 2 }),
        ],
        t3: [tv({ personId: 'p4', pointValue: 1, cleanHits: 7 })],
      },
    });

    const res = await service.getEventStatistics('e1', 'user-1');

    // Three groups, sorted by weapon name asc with the weapon-less one last.
    expect(res.weaponBreakdown.map((w) => w.weapon)).toEqual(['longsword', 'rapier', null]);
    // The sentinel groups the rows; it must never surface as a weapon name.
    expect(res.weaponBreakdown[2]!.hunters.map((h) => h.personId)).toEqual(['p4']);

    const [longsword, rapier] = res.weaponBreakdown;
    // Longsword: deep target = 2; distribution sorted asc; hunters at value 2.
    expect(longsword!.maxValue).toBe(2);
    expect(longsword!.distribution).toEqual([
      { value: 1, cleanHits: 4 },
      { value: 2, cleanHits: 8 },
    ]);
    expect(longsword!.hunters.map((h) => h.personId)).toEqual(['p1', 'p2']);
    // Rapier: ruleset-aware deep target = 3 (not hardcoded to 2).
    expect(rapier!.maxValue).toBe(3);
    expect(rapier!.hunters[0]).toMatchObject({ personId: 'p3', cleanHits: 6 });
  });
});
