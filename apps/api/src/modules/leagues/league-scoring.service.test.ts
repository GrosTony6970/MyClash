import { describe, expect, it, vi } from 'vitest';
import { LeagueScoringService } from './league-scoring.service';
import type { LeagueScoringConfig, TournamentContributionInput } from '@myclash/rules/results';

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
    // `in` rather than `??`: an explicit `groupName: null` is a real case — a
    // tournament linked with no group — and `??` would quietly hand it the
    // default instead, making it impossible to test the one thing it is for.
    groupName: 'groupName' in overrides ? (overrides.groupName ?? null) : 'Open',
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

  it('groups rankings by weapon, by weapon and league group, or by group alone', () => {
    expect(service.groupKey(baseConfig, contribution('f1', 1))).toBe('longsword');
    expect(
      service.groupKey(
        { ...baseConfig, rankingDimensions: 'weapon_category' },
        contribution('f1', 1),
      ),
    ).toBe('longsword::open');
    // Group alone: the weapon must not appear at all, or two weapons in the same
    // division would still be ranked apart — the thing this mode exists to stop.
    expect(
      service.groupKey({ ...baseConfig, rankingDimensions: 'group' }, contribution('f1', 1)),
    ).toBe('open');
  });

  it('sends every ungrouped tournament to one table rather than dropping it', () => {
    // A link with no group normalises to `unknown` in every mode, so an
    // ungrouped league still ranks — it does not silently produce no key.
    expect(
      service.groupKey(
        { ...baseConfig, rankingDimensions: 'group' },
        contribution('f1', 1, { groupName: null }),
      ),
    ).toBe('unknown');
    expect(
      service.groupKey(
        { ...baseConfig, rankingDimensions: 'weapon_category' },
        contribution('f1', 1, { groupName: null }),
      ),
    ).toBe('longsword::unknown');
  });

  it('keeps two weapons in one division together under group, and apart otherwise', () => {
    const groupOnly: LeagueScoringConfig = { ...baseConfig, rankingDimensions: 'group' };
    const longsword = contribution('f1', 1, { weapon: 'Longsword' });
    const sidesword = contribution('f2', 1, { weapon: 'Sidesword' });

    expect(service.groupKey(groupOnly, longsword)).toBe(service.groupKey(groupOnly, sidesword));

    const weaponGroup: LeagueScoringConfig = {
      ...baseConfig,
      rankingDimensions: 'weapon_category',
    };
    expect(service.groupKey(weaponGroup, longsword)).not.toBe(
      service.groupKey(weaponGroup, sidesword),
    );
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

    it('resolves a pinned code@version to the snapshot, not the current row', async () => {
      // Registry row holds the LATEST values (1.0.1: edited to 30/20/10).
      // The 1.0.0 snapshot in the versions table holds the ORIGINAL values
      // (16/13/11). A league pinned to 'ffamhe_tf_2026@1.0.0' must keep
      // resolving against the 1.0.0 snapshot even after edits roll the
      // registry forward.
      const registryRow = {
        id: 'sys-ffamhe',
        points_by_rank: { '1': 30, '2': 20, '3': 10 },
        tie_breakers: ['total_points'],
      };
      const versionRow = {
        points_by_rank: { '1': 16, '2': 13, '3': 11 },
        tie_breakers: ['total_points', 'medal_count', 'double_hit_average'],
      };

      const supabase = {
        service: {
          from: vi.fn((table: string) => {
            if (table === 'league_scoring_systems') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: registryRow, error: null }),
              };
            }
            if (table === 'league_scoring_system_versions') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: versionRow, error: null }),
              };
            }
            return {} as never;
          }),
        },
      };
      const svc = new LeagueScoringService(supabase as never);

      const resolved = await svc.resolveConfig({
        scoringSystem: 'ffamhe_tf_2026@1.0.0',
        rankingDimensions: 'weapon',
        tieBreakers: ['total_points'],
      });

      // Resolved points are the 1.0.0 SNAPSHOT, NOT the current registry row.
      expect(resolved.customPointsByRank).toEqual({ 1: 16, 2: 13, 3: 11 });
      expect(resolved.tieBreakers).toEqual(['total_points', 'medal_count', 'double_hit_average']);
    });

    it('falls back to the current registry row when the pinned version snapshot is missing', async () => {
      // Defensive: a league references @9.9.9 but no such snapshot exists.
      // The resolver must NOT return zero points; instead use the current row.
      const registryRow = {
        id: 'sys-ffamhe',
        points_by_rank: { '1': 30, '2': 20, '3': 10 },
        tie_breakers: ['total_points'],
      };
      const supabase = {
        service: {
          from: vi.fn((table: string) => {
            if (table === 'league_scoring_systems') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: registryRow, error: null }),
              };
            }
            if (table === 'league_scoring_system_versions') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              };
            }
            return {} as never;
          }),
        },
      };
      const svc = new LeagueScoringService(supabase as never);

      const resolved = await svc.resolveConfig({
        scoringSystem: 'ffamhe_tf_2026@9.9.9',
        rankingDimensions: 'weapon',
        tieBreakers: ['total_points'],
      });

      // Fallback to current registry row.
      expect(resolved.customPointsByRank).toEqual({ 1: 30, 2: 20, 3: 10 });
    });
  });

  it('throws actionable validation errors for missing global Fighter IDs', () => {
    expect(() =>
      service.validateContributionIdentities([
        contribution('', 1, { fighterName: 'Unlinked Fighter' }),
      ]),
    ).toThrow('Unlinked Fighter');
  });

  describe('medal derivation from resultKind', () => {
    const input = (
      fighterId: string,
      finalRank: number,
      resultKind: TournamentContributionInput['resultKind'],
    ): TournamentContributionInput => ({
      leagueId: 'league-1',
      tournamentId: 'tournament-1',
      eventId: 'event-1',
      fighterId,
      fighterName: fighterId,
      clubName: null,
      clubCity: null,
      weapon: 'Longsword',
      groupName: 'Open',
      finalRank,
      resultKind,
      doubleHits: 0,
    });

    it('maps bracket result kinds to the real podium', () => {
      const rows = service.toTournamentContributions(baseConfig, [
        input('champ', 1, 'champion'),
        input('runner', 2, 'runnerUp'),
        input('bronze', 3, 'third'),
        input('fourth', 4, 'fourth'),
      ]);
      expect(rows.map((r) => r.medal)).toEqual(['gold', 'silver', 'bronze', null]);
    });

    it('gives NO medal to a 3rd place with no bronze match (resultKind round)', () => {
      // A semi-final loser ranked 3rd WITHOUT a playoff is 'round', not 'third'
      // — awarding bronze here was the old bug.
      const [row] = service.toTournamentContributions(baseConfig, [input('sf-loser', 3, 'round')]);
      expect(row?.medal).toBeNull();
    });

    it('falls back to place 1/2/3 for pool-only and legacy rank-only inputs', () => {
      const pool = service.toTournamentContributions(baseConfig, [
        input('p1', 1, 'pool'),
        input('p3', 3, 'pool'),
      ]);
      expect(pool.map((r) => r.medal)).toEqual(['gold', 'bronze']);
      // resultKind omitted entirely (legacy contribution) → rank-based medal.
      const [legacy] = service.toTournamentContributions(baseConfig, [input('l2', 2, undefined)]);
      expect(legacy?.medal).toBe('silver');
    });
  });
});
