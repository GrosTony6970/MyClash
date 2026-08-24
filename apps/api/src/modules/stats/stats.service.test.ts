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

/** A blow-value row, as `fighter_blow_value_stats` returns it (migration 0189). */
function blowRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    registration_id: 'r1',
    point_value: 1,
    hits_given: 0,
    afterblow_given: 0,
    hits_received: 0,
    afterblow_received: 0,
    ...overrides,
  };
}

const resolveMock = vi.fn();
const mockResolver = { resolve: resolveMock };

/**
 * The two RPCs answer on their function name, not on call order — the service
 * issues them through Promise.all, so an ordered mock would depend on which
 * settles first.
 */
function wireRpc(fighters: unknown[], blows: unknown[] = []) {
  rpcMock.mockImplementation((fn: string) =>
    Promise.resolve(
      fn === 'fighter_blow_value_stats'
        ? { data: blows, error: null }
        : { data: fighters, error: null },
    ),
  );
}

/** tournaments.select(...).eq(...).maybeSingle() → the ruleset the bout used. */
function wireTournament(rulesetCode: string | null = 'TF_v1', rulesetVersion = '1') {
  const chain: Record<string, unknown> = {};
  for (const k of ['select', 'eq']) chain[k] = vi.fn(() => chain);
  chain['maybeSingle'] = vi.fn().mockResolvedValue({
    data: rulesetCode ? { ruleset_code: rulesetCode, ruleset_version: rulesetVersion } : null,
    error: null,
  });
  fromMock.mockReturnValue(chain);
}

function makeService() {
  return new StatsService(mockSupabase as never, mockResolver as never);
}

describe('StatsService', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    resolveMock.mockReset();
    resolveMock.mockResolvedValue(null);
    wireTournament(null);
  });

  describe('getFighterStats', () => {
    it('calls the on-read fighter_exchange_stats RPC and maps rows', async () => {
      wireRpc([row()]);

      const { fighters } = await makeService().getFighterStats('tour-1');

      expect(rpcMock).toHaveBeenCalledWith('fighter_exchange_stats', {
        p_tournament_id: 'tour-1',
      });
      expect(fighters).toHaveLength(1);
      expect(fighters[0]).toMatchObject({
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

    it('returns no fighters when the function errors (e.g. pre-migration)', async () => {
      rpcMock.mockResolvedValue({ data: null, error: { message: 'missing function' } });
      expect((await makeService().getFighterStats('tour-1')).fighters).toEqual([]);
    });

    it('maps a null hit_ratio/point_ratio to null', async () => {
      wireRpc([row({ hit_ratio: null, point_ratio: null })]);
      const [only] = (await makeService().getFighterStats('tour-1')).fighters;
      expect(only).toBeDefined();
      expect(only?.hitRatio).toBeNull();
      expect(only?.pointRatio).toBeNull();
    });

    it('carries a point value ABOVE 3, which the old fixed buckets could not', async () => {
      // The defect this replaced: hits were counted into hits_given_1/2/3 only,
      // so a target worth 4 or more was invisible in every blow column while
      // still counting in blowsGiven and both ratios. A value is data now.
      wireRpc(
        [row()],
        [
          blowRow({ point_value: 1, hits_given: 2 }),
          blowRow({ point_value: 7, hits_given: 1, afterblow_received: 3 }),
        ],
      );

      const [fighter] = (await makeService().getFighterStats('tour-1')).fighters;

      expect(fighter?.byValue).toEqual([
        { value: 1, hitsGiven: 2, afterblowGiven: 0, hitsReceived: 0, afterblowReceived: 0 },
        { value: 7, hitsGiven: 1, afterblowGiven: 0, hitsReceived: 0, afterblowReceived: 3 },
      ]);
    });

    it('gives a fighter with no blows an empty list rather than dropping them', async () => {
      wireRpc([row(), row({ registration_id: 'r2' })], [blowRow({ point_value: 2 })]);
      const { fighters } = await makeService().getFighterStats('tour-1');
      expect(fighters).toHaveLength(2);
      expect(fighters[1]?.byValue).toEqual([]);
    });

    it("sorts each fighter's values ascending, whatever order SQL returned", async () => {
      wireRpc([row()], [blowRow({ point_value: 5 }), blowRow({ point_value: 2 })]);
      const [fighter] = (await makeService().getFighterStats('tour-1')).fighters;
      expect(fighter?.byValue.map((v) => v.value)).toEqual([2, 5]);
    });
  });

  describe('the afterblow label rule', () => {
    it("reports the ruleset's own valuation, so the column is not headed -1 by assumption", async () => {
      // The blow table heads its afterblow columns `✓2-1`: struck for 2, took an
      // afterblow worth 1. That 1 is FFAMHE's rule, not every ruleset's.
      wireRpc([row()]);
      wireTournament('TF_v1', '1');
      resolveMock.mockResolvedValue({
        metadata: { hasAfterblow: true, afterblowValuation: 'fixed', afterblowFixedValue: 1 },
      });

      const { afterblow } = await makeService().getFighterStats('tour-1');

      expect(resolveMock).toHaveBeenCalledWith('TF_v1', '1.0.0');
      expect(afterblow).toEqual({ valuation: 'fixed', fixedValue: 1 });
    });

    it('reports weighted, where no single number can label the column', async () => {
      wireRpc([row()]);
      wireTournament('custom_x', '2');
      resolveMock.mockResolvedValue({
        metadata: { hasAfterblow: true, afterblowValuation: 'weighted', afterblowFixedValue: null },
      });

      const { afterblow } = await makeService().getFighterStats('tour-1');

      expect(afterblow).toEqual({ valuation: 'weighted', fixedValue: null });
    });

    it('claims nothing when the ruleset has no afterblow concept', async () => {
      wireRpc([row()]);
      wireTournament('Generic_PointsCap', '1');
      resolveMock.mockResolvedValue({ metadata: { hasAfterblow: false } });

      const { afterblow } = await makeService().getFighterStats('tour-1');

      expect(afterblow).toEqual({ valuation: null, fixedValue: null });
    });

    it('claims nothing when the ruleset cannot be resolved at all', async () => {
      wireRpc([row()]);
      wireTournament('gone', '1');
      resolveMock.mockResolvedValue(null);

      const { afterblow } = await makeService().getFighterStats('tour-1');

      expect(afterblow).toEqual({ valuation: null, fixedValue: null });
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
