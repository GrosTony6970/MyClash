import { describe, expect, it, vi } from 'vitest';
import { LeagueScoringService } from './league-scoring.service';
import type { LeagueScoringConfig, TournamentContributionInput } from './league.types';

const baseConfig: LeagueScoringConfig = {
  scoringSystem: 'ffamhe_tf_2026',
  rankingDimensions: 'weapon',
  tieBreakers: ['total_points', 'participation_count', 'medal_count', 'double_hit_average'],
};

function contribution(
  fighterId: string,
  rank: number,
  overrides: Partial<TournamentContributionInput> = {},
): TournamentContributionInput {
  return {
    leagueId: 'league-1',
    tournamentId: overrides.tournamentId ?? 'tournament-1',
    eventId: overrides.eventId ?? 'event-1',
    fighterId,
    fighterName: overrides.fighterName ?? fighterId,
    clubName: overrides.clubName ?? null,
    clubCity: overrides.clubCity ?? null,
    weapon: overrides.weapon ?? 'Longsword',
    groupName: overrides.groupName ?? 'Open',
    finalRank: rank,
    doubleHits: overrides.doubleHits ?? 0,
  };
}

describe('LeagueScoringService', () => {
  const service = new LeagueScoringService();

  it('awards FFAMHE TF points to ranks 1-16 and zero after rank 16', () => {
    expect(service.pointsForRank(baseConfig, 1)).toBe(16);
    expect(service.pointsForRank(baseConfig, 16)).toBe(1);
    expect(service.pointsForRank(baseConfig, 17)).toBe(0);
  });

  it('uses custom rank points without evaluating formulas', () => {
    const config: LeagueScoringConfig = {
      scoringSystem: 'custom',
      rankingDimensions: 'weapon',
      customPointsByRank: { 1: 100, 2: 50 },
      tieBreakers: ['total_points'],
    };

    expect(service.pointsForRank(config, 1)).toBe(100);
    expect(service.pointsForRank(config, 3)).toBe(0);
  });

  it('groups rankings by weapon or by weapon and league group', () => {
    expect(service.groupKey(baseConfig, contribution('f1', 1))).toBe('longsword');
    expect(
      service.groupKey(
        { ...baseConfig, rankingDimensions: 'weapon_category' },
        contribution('f1', 1),
      ),
    ).toBe('longsword::open');
  });

  it('aggregates duplicate fighter contributions and sorts by configured tie-breakers', () => {
    const rows = service.computeRankings(baseConfig, [
      contribution('f-a', 1, {
        tournamentId: 't1',
        eventId: 'event-1',
        fighterName: 'Alice',
        doubleHits: 3,
      }),
      contribution('f-a', 2, {
        tournamentId: 't2',
        eventId: 'event-2',
        fighterName: 'Alice',
        doubleHits: 1,
      }),
      contribution('f-b', 1, {
        tournamentId: 't3',
        eventId: 'event-3',
        fighterName: 'Bob',
        doubleHits: 0,
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      fighterId: 'f-a',
      // FFAMHE TF 2026 fallback: rank 1 = 16, rank 2 = 13 → 29 total.
      totalPoints: 29,
      participationCount: 2,
      medalCount: 2,
      rank: 1,
    });
    expect(rows[0]?.perTournament).toHaveLength(2);
    expect(rows[1]).toMatchObject({ fighterId: 'f-b', totalPoints: 16, rank: 2 });
  });

  it('uses lower double-hit average as a tie-breaker', () => {
    const rows = service.computeRankings(baseConfig, [
      contribution('f-a', 1, { tournamentId: 't1', fighterName: 'Alice', doubleHits: 4 }),
      contribution('f-b', 1, { tournamentId: 't1', fighterName: 'Bob', doubleHits: 1 }),
    ]);

    expect(rows.map((row) => row.fighterId)).toEqual(['f-b', 'f-a']);
  });

  describe('resolveConfig (registry hydration)', () => {
    function makeServiceWithRegistry(
      row: { points_by_rank: unknown; tie_breakers: unknown } | null,
    ) {
      const supabase = {
        service: {
          from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
          })),
        },
      };
      return new LeagueScoringService(supabase as never);
    }

    it('hydrates customPointsByRank and tieBreakers from the registry row', async () => {
      const svc = makeServiceWithRegistry({
        points_by_rank: { '1': 30, '2': 20, '3': 10 },
        tie_breakers: ['total_points', 'medal_count'],
      });
      const resolved = await svc.resolveConfig({
        scoringSystem: 'custom_2027',
        rankingDimensions: 'weapon',
        tieBreakers: ['total_points'],
      });
      expect(resolved.customPointsByRank).toEqual({ 1: 30, 2: 20, 3: 10 });
      expect(resolved.tieBreakers).toEqual(['total_points', 'medal_count']);
    });

    it('returns the config unchanged when scoringSystem is custom', async () => {
      const svc = makeServiceWithRegistry({ points_by_rank: { '1': 99 }, tie_breakers: [] });
      const cfg: LeagueScoringConfig = {
        scoringSystem: 'custom',
        rankingDimensions: 'weapon',
        customPointsByRank: { 1: 5 },
        tieBreakers: ['total_points'],
      };
      const resolved = await svc.resolveConfig(cfg);
      expect(resolved).toBe(cfg);
    });

    it('falls back silently when the registry row is missing', async () => {
      const svc = makeServiceWithRegistry(null);
      const cfg: LeagueScoringConfig = {
        scoringSystem: 'nonexistent_code',
        rankingDimensions: 'weapon',
        tieBreakers: ['total_points'],
      };
      const resolved = await svc.resolveConfig(cfg);
      expect(resolved.customPointsByRank).toBeUndefined();
    });
  });

  it('throws actionable validation errors for missing global Fighter IDs', () => {
    expect(() =>
      service.validateContributionIdentities([
        contribution('', 1, { fighterName: 'Unlinked Fighter' }),
      ]),
    ).toThrow('Unlinked Fighter');
  });
});
