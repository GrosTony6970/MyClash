import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StatsService } from './stats.service';

// ── Supabase mock ──────────────────────────────────────────────────────────────
// getFighterStats now calls supabase.service.rpc('fighter_exchange_stats', …);
// getTournamentOverview additionally counts matches/exchanges via from()…{count}.
const rpcMock = vi.fn();
const fromMock = vi.fn();
const mockSupabase = { service: { rpc: rpcMock, from: fromMock } };

// from('matches'|'exchanges').select(id,{count,head}).eq().eq()/.neq() → { count }
function makeCountChain(count: number) {
  const chain = Object.assign(Promise.resolve({ count, data: null, error: null })) as Promise<{
    count: number;
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
      fromMock.mockImplementation((table: string) => makeCountChain(table === 'matches' ? 5 : 10));

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
