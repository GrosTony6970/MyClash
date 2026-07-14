import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StatsService } from './stats.service';

// ── Supabase mock ──────────────────────────────────────────────────────────────
// getFighterStats now calls supabase.service.rpc('fighter_exchange_stats', …);
// getTournamentOverview additionally counts matches/exchanges via from()…{count}.
const rpcMock = vi.fn();
const fromMock = vi.fn();
const mockSupabase = { service: { rpc: rpcMock, from: fromMock } };

// from('matches'|'exchanges').select(id,{count,head}).eq().eq()/.neq() → { count }
function makeCountChain(count: number | null, error: { message: string } | null = null) {
  const chain = Object.assign(Promise.resolve({ count, data: null, error })) as Promise<{
    count: number | null;
  }> &
    Record<string, unknown>;
  for (const k of ['select', 'eq', 'neq']) chain[k] = vi.fn().mockReturnValue(chain);
  return chain;
}

// A raw MV/function row (snake_case, as PostgREST returns it).
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    registration_id: 'r1',
    person_id: 'p1',
    given_name: 'Ann',
    family_name: 'Red',
    club_name: 'Lyon',
    doubles: 2,
    hits_given_1: 1,
    afterblow_given_1: 0,
    hits_given_2: 0,
    afterblow_given_2: 0,
    hits_received_1: 1,
    afterblow_received_1: 0,
    hits_received_2: 0,
    afterblow_received_2: 0,
    blows_given: 3,
    blows_received: 2,
    afterblows_received_total: 0,
    points_given: 3,
    points_received: 1,
    total_exchanges: 5,
    hit_ratio: 1.5,
    point_ratio: 3,
    ...overrides,
  };
}

function makeService() {
  return new StatsService(mockSupabase as never);
}

describe('StatsService', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  describe('getFighterStats', () => {
    it('calls the on-read fighter_exchange_stats RPC and maps rows', async () => {
      rpcMock.mockResolvedValue({ data: [row()], error: null });

      const result = await makeService().getFighterStats('tour-1');

      expect(rpcMock).toHaveBeenCalledWith('fighter_exchange_stats', {
        p_tournament_id: 'tour-1',
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        registrationId: 'r1',
        givenName: 'Ann',
        familyName: 'Red',
        clubName: 'Lyon',
        doubles: 2,
        blowsGiven: 3,
        pointsGiven: 3,
        pointsReceived: 1,
        hitRatio: 1.5,
        pointRatio: 3,
      });
    });

    it('returns [] when the function errors (e.g. pre-migration)', async () => {
      rpcMock.mockResolvedValue({ data: null, error: { message: 'missing function' } });
      expect(await makeService().getFighterStats('tour-1')).toEqual([]);
    });

    it('maps a null hit_ratio/point_ratio to null', async () => {
      rpcMock.mockResolvedValue({
        data: [row({ hit_ratio: null, point_ratio: null })],
        error: null,
      });
      const [only] = await makeService().getFighterStats('tour-1');
      expect(only).toBeDefined();
      expect(only?.hitRatio).toBeNull();
      expect(only?.pointRatio).toBeNull();
    });

    it('maps value-3 buckets (migration 0136), defaulting missing ones to 0', async () => {
      rpcMock.mockResolvedValue({
        data: [
          row({
            hits_given_3: 3,
            afterblow_given_3: 1,
            hits_received_3: 2,
            afterblow_received_3: 0,
          }),
          row({ registration_id: 'r2' }), // no value-3 keys → all 0
        ],
        error: null,
      });
      const [a, b] = await makeService().getFighterStats('tour-1');
      expect(a).toMatchObject({
        hitsGiven3: 3,
        afterblowGiven3: 1,
        hitsReceived3: 2,
        afterblowReceived3: 0,
      });
      expect(b).toMatchObject({ hitsGiven3: 0, afterblowGiven3: 0, hitsReceived3: 0 });
    });
  });

  describe('getTargetValueRows', () => {
    it('calls tournament_target_value_stats and maps snake→camel', async () => {
      rpcMock.mockResolvedValue({
        data: [
          {
            registration_id: 'r1',
            person_id: 'p1',
            given_name: 'Ann',
            family_name: 'Red',
            club_name: 'Lyon',
            point_value: 2,
            clean_hits: 4,
          },
        ],
        error: null,
      });
      const rows = await makeService().getTargetValueRows('tour-1');
      expect(rpcMock).toHaveBeenCalledWith('tournament_target_value_stats', {
        p_tournament_id: 'tour-1',
      });
      expect(rows).toEqual([
        {
          registrationId: 'r1',
          personId: 'p1',
          givenName: 'Ann',
          familyName: 'Red',
          clubName: 'Lyon',
          pointValue: 2,
          cleanHits: 4,
        },
      ]);
    });

    it('returns [] when the function errors (pre-migration)', async () => {
      rpcMock.mockResolvedValue({ data: null, error: { message: 'missing function' } });
      expect(await makeService().getTargetValueRows('tour-1')).toEqual([]);
    });
  });

  describe('aggregateTargetValues', () => {
    const tv = (o: Partial<Parameters<typeof StatsService.aggregateTargetValues>[0][number]>) => ({
      registrationId: 'r',
      personId: 'p',
      givenName: 'A',
      familyName: 'B',
      clubName: null as string | null,
      pointValue: 1,
      cleanHits: 1,
      ...o,
    });

    it('returns nulls/empties for no rows', () => {
      expect(StatsService.aggregateTargetValues([])).toEqual({
        maxValue: null,
        distribution: [],
        hunters: [],
      });
    });

    it('derives maxValue = highest value present (supports 3) and sorts distribution asc', () => {
      const res = StatsService.aggregateTargetValues([
        tv({ personId: 'p1', pointValue: 2, cleanHits: 5 }),
        tv({ personId: 'p2', pointValue: 1, cleanHits: 3 }),
        tv({ personId: 'p3', pointValue: 3, cleanHits: 2 }),
      ]);
      expect(res.maxValue).toBe(3);
      expect(res.distribution).toEqual([
        { value: 1, cleanHits: 3 },
        { value: 2, cleanHits: 5 },
        { value: 3, cleanHits: 2 },
      ]);
    });

    it('ranks hunters by clean hits AT maxValue, ties by name, top 5', () => {
      const res = StatsService.aggregateTargetValues([
        tv({ personId: 'p1', givenName: 'Zoe', familyName: '', pointValue: 2, cleanHits: 4 }),
        tv({ personId: 'p2', givenName: 'Amy', familyName: '', pointValue: 2, cleanHits: 4 }),
        tv({ personId: 'p3', givenName: 'Bo', familyName: '', pointValue: 2, cleanHits: 7 }),
        tv({ personId: 'p4', givenName: 'Cy', familyName: '', pointValue: 1, cleanHits: 9 }),
      ]);
      expect(res.maxValue).toBe(2);
      // Bo (7) leads; tie at 4 broken by name → Amy before Zoe; p4 excluded (value 1 ≠ maxValue).
      expect(res.hunters.map((h) => h.name)).toEqual(['Bo', 'Amy', 'Zoe']);
    });

    it('merges the same person across tournaments (sum clean hits at maxValue, keep club)', () => {
      const res = StatsService.aggregateTargetValues([
        tv({ personId: 'p1', givenName: 'Ann', familyName: 'R', pointValue: 2, cleanHits: 3 }),
        tv({
          personId: 'p1',
          givenName: 'Ann',
          familyName: 'R',
          pointValue: 2,
          cleanHits: 2,
          clubName: 'Lyon',
        }),
      ]);
      expect(res.hunters).toHaveLength(1);
      expect(res.hunters[0]).toMatchObject({ personId: 'p1', cleanHits: 5, club: 'Lyon' });
    });
  });

  describe('getTournamentOverview', () => {
    it('derives doubles/percent/clubs/topFighters from RPC rows + live counts', async () => {
      // Two fighters: A (ratio 1.5, club Lyon), B (ratio null, club Paris).
      rpcMock.mockResolvedValue({
        data: [
          row({
            registration_id: 'r1',
            given_name: 'Ann',
            club_name: 'Lyon',
            doubles: 2,
            hit_ratio: 1.5,
          }),
          row({
            registration_id: 'r2',
            given_name: 'Bob',
            club_name: 'Paris',
            doubles: 2,
            hit_ratio: null,
          }),
        ],
        error: null,
      });
      // matches count = 5, exchanges count = 10
      const chains: Record<string, ReturnType<typeof makeCountChain>> = {};
      fromMock.mockImplementation(
        (table: string) => (chains[table] = makeCountChain(table === 'matches' ? 5 : 10)),
      );

      const o = await makeService().getTournamentOverview('tour-1');

      expect(o.participantCount).toBe(2);
      expect(o.matchCount).toBe(5);
      expect(o.exchangeCount).toBe(10);
      // each double is counted once per fighter → sum(4)/2 = 2
      expect(o.doublesCount).toBe(2);
      // round(2 / 10 * 100) = 20
      expect(o.doublesPercent).toBe(20);
      expect(o.clubCount).toBe(2);
      // only fighters with a non-null hitRatio appear in topFighters
      expect(o.topFighters).toHaveLength(1);
      expect(o.topFighters[0]).toMatchObject({ name: 'Ann Red', club: 'Lyon', hitRatio: 1.5 });

      // Regression guard: matches/exchanges have no tournament_id column — the
      // counts MUST reach the tournament through phases, never a direct
      // .eq('tournament_id', …) (which PostgREST-400s and silently returns 0).
      expect(chains['matches']?.select).toHaveBeenCalledWith('id, phases!inner(tournament_id)', {
        count: 'exact',
        head: true,
      });
      expect(chains['matches']?.eq).toHaveBeenCalledWith('phases.tournament_id', 'tour-1');
      expect(chains['exchanges']?.select).toHaveBeenCalledWith(
        'id, matches!inner(phases!inner(tournament_id))',
        { count: 'exact', head: true },
      );
      expect(chains['exchanges']?.eq).toHaveBeenCalledWith(
        'matches.phases.tournament_id',
        'tour-1',
      );
    });

    it('surfaces (does not swallow) a count-query error', async () => {
      rpcMock.mockResolvedValue({ data: [], error: null });
      // A broken count query (e.g. an unknown column) must throw, not become 0.
      fromMock.mockImplementation(() =>
        makeCountChain(null, { message: 'column "tournament_id" does not exist' }),
      );

      await expect(makeService().getTournamentOverview('tour-1')).rejects.toThrow(
        /count(Matches|Exchanges) failed/,
      );
    });

    it('reports 0 doubles% when there are no exchanges', async () => {
      rpcMock.mockResolvedValue({ data: [], error: null });
      fromMock.mockImplementation(() => makeCountChain(0));

      const o = await makeService().getTournamentOverview('tour-1');
      expect(o.participantCount).toBe(0);
      expect(o.doublesPercent).toBe(0);
      expect(o.topFighters).toEqual([]);
    });
  });
});
