import { describe, expect, it } from 'vitest';
import {
  compareRankings,
  computeRankingsFromContributions,
  groupKey,
  medalFor,
  pointsForRank,
  tiedOnChain,
} from './league-scoring';
import type {
  LeagueScoringConfig,
  LeagueTournamentContribution,
  TournamentContributionInput,
} from './league-types';

/**
 * The pure half of what `LeagueScoringService` used to test.
 *
 * The `pointsForRank` and `groupKey` cases came across from
 * `apps/api/src/modules/leagues/league-scoring.service.test.ts` and now call the
 * functions directly instead of through the class. The rest is new: before this,
 * `computeRankingsFromContributions`, `compareRankings` and `medalFor` were only
 * ever reached through a Nest service, so this package's own suite could not
 * tell whether its own ranking maths still worked.
 */

const baseConfig: LeagueScoringConfig = {
  scoringSystem: 'ffamhe_tf_2026',
  rankingDimensions: 'weapon',
  tieBreakers: ['total_points', 'participation_count', 'medal_count', 'double_hit_average'],
};

function input(
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

function contribution(
  fighterId: string,
  overrides: Partial<LeagueTournamentContribution> = {},
): LeagueTournamentContribution {
  return {
    leagueId: 'league-1',
    tournamentId: overrides.tournamentId ?? 'tournament-1',
    eventId: overrides.eventId ?? 'event-1',
    fighterId,
    fighterName: overrides.fighterName ?? fighterId,
    clubName: overrides.clubName ?? null,
    clubCity: overrides.clubCity ?? null,
    rankingGroupKey: overrides.rankingGroupKey ?? 'longsword',
    weapon: overrides.weapon ?? 'Longsword',
    groupName: overrides.groupName ?? 'Open',
    finalRank: overrides.finalRank ?? 1,
    leaguePoints: overrides.leaguePoints ?? 0,
    medal: overrides.medal ?? null,
    doubleHits: overrides.doubleHits ?? 0,
  };
}

describe('pointsForRank', () => {
  it('awards FFAMHE TF points to ranks 1-16 and zero after rank 16', () => {
    expect(pointsForRank(baseConfig, 1)).toBe(16);
    expect(pointsForRank(baseConfig, 16)).toBe(1);
    expect(pointsForRank(baseConfig, 17)).toBe(0);
  });

  it('uses custom rank points without evaluating formulas', () => {
    const config: LeagueScoringConfig = {
      ...baseConfig,
      scoringSystem: 'custom',
      customPointsByRank: { 1: 100, 2: 50 },
    };

    expect(pointsForRank(config, 1)).toBe(100);
    expect(pointsForRank(config, 3)).toBe(0);
  });

  it('refuses a rank that is not a positive integer', () => {
    expect(pointsForRank(baseConfig, 0)).toBe(0);
    expect(pointsForRank(baseConfig, -1)).toBe(0);
    expect(pointsForRank(baseConfig, 1.5)).toBe(0);
  });
});

describe('groupKey', () => {
  it('groups by weapon, by weapon and league group, or by group alone', () => {
    expect(groupKey(baseConfig, input('f1', 1))).toBe('longsword');
    expect(groupKey({ ...baseConfig, rankingDimensions: 'weapon_category' }, input('f1', 1))).toBe(
      'longsword::open',
    );
    expect(groupKey({ ...baseConfig, rankingDimensions: 'group' }, input('f1', 1))).toBe('open');
  });

  it('sends every ungrouped tournament to one table rather than dropping it', () => {
    const ungrouped = input('f1', 1, { groupName: null });

    expect(groupKey({ ...baseConfig, rankingDimensions: 'group' }, ungrouped)).toBe('unknown');
    expect(groupKey({ ...baseConfig, rankingDimensions: 'weapon_category' }, ungrouped)).toBe(
      'longsword::unknown',
    );
  });

  it('keeps two weapons in one division together under group, and apart otherwise', () => {
    const groupOnly: LeagueScoringConfig = { ...baseConfig, rankingDimensions: 'group' };
    const weaponGroup: LeagueScoringConfig = {
      ...baseConfig,
      rankingDimensions: 'weapon_category',
    };
    const longsword = input('f1', 1, { weapon: 'Longsword' });
    const sidesword = input('f2', 1, { weapon: 'Sidesword' });

    expect(groupKey(groupOnly, longsword)).toBe(groupKey(groupOnly, sidesword));
    expect(groupKey(weaponGroup, longsword)).not.toBe(groupKey(weaponGroup, sidesword));
  });

  it('folds accents and punctuation so one division is one table', () => {
    const accented = input('f1', 1, { weapon: 'Épée', groupName: 'Séniors A' });

    expect(groupKey({ ...baseConfig, rankingDimensions: 'weapon_category' }, accented)).toBe(
      'epee::seniors-a',
    );
  });
});

describe('computeRankingsFromContributions', () => {
  it('adds a fighter up across tournaments and keeps every one of them listed', () => {
    const rows = computeRankingsFromContributions(baseConfig, [
      contribution('f-a', { tournamentId: 't1', leaguePoints: 16, medal: 'gold', doubleHits: 3 }),
      contribution('f-a', { tournamentId: 't2', leaguePoints: 13, medal: 'silver', doubleHits: 1 }),
      contribution('f-b', { tournamentId: 't3', leaguePoints: 16, medal: 'gold' }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      fighterId: 'f-a',
      totalPoints: 29,
      participationCount: 2,
      medalCount: 2,
      rank: 1,
    });
    expect(rows[0]?.perTournament).toHaveLength(2);
    expect(rows[0]?.doubleHitAverage).toBe(2);
    expect(rows[1]).toMatchObject({ fighterId: 'f-b', totalPoints: 16, rank: 2 });
  });

  it('keeps one fighter in two ranking groups apart', () => {
    const rows = computeRankingsFromContributions(baseConfig, [
      contribution('f-a', { rankingGroupKey: 'longsword', leaguePoints: 16 }),
      contribution('f-a', { rankingGroupKey: 'sidesword', leaguePoints: 13 }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.totalPoints)).toEqual([16, 13]);
  });

  it('gives EVERY ranking group a rank 1, not just the strongest', () => {
    // The bug this replaces: ranks were numbered over the whole set, so the
    // sidesword winner was stored as rank 3 behind two longsword fighters --
    // and the public page finds champions with `row.rank === 1`, so that table
    // showed none at all.
    const rows = computeRankingsFromContributions({ tieBreakers: ['total_points'] }, [
      contribution('f-a', { rankingGroupKey: 'longsword', fighterName: 'Alice', leaguePoints: 30 }),
      contribution('f-b', { rankingGroupKey: 'longsword', fighterName: 'Bob', leaguePoints: 20 }),
      contribution('f-x', { rankingGroupKey: 'sidesword', fighterName: 'Xena', leaguePoints: 15 }),
      contribution('f-y', { rankingGroupKey: 'sidesword', fighterName: 'Yuri', leaguePoints: 10 }),
    ]);

    const rankIn = (group: string) =>
      rows.filter((row) => row.rankingGroupKey === group).map((row) => [row.fighterId, row.rank]);

    expect(rankIn('longsword')).toEqual([
      ['f-a', 1],
      ['f-b', 2],
    ]);
    expect(rankIn('sidesword')).toEqual([
      ['f-x', 1],
      ['f-y', 2],
    ]);

    for (const group of ['longsword', 'sidesword']) {
      expect(
        rows.filter((row) => row.rankingGroupKey === group && row.rank === 1),
        `${group} must have exactly one champion`,
      ).toHaveLength(1);
    }
  });

  it('lets a weaker group outrank a stronger one, because they are separate competitions', () => {
    const rows = computeRankingsFromContributions({ tieBreakers: ['total_points'] }, [
      contribution('f-a', { rankingGroupKey: 'longsword', leaguePoints: 100 }),
      contribution('f-x', { rankingGroupKey: 'sidesword', leaguePoints: 1 }),
    ]);

    expect(rows.every((row) => row.rank === 1)).toBe(true);
  });

  it('gives two fighters level on every configured key the SAME rank, and skips the next', () => {
    const rows = computeRankingsFromContributions({ tieBreakers: ['total_points'] }, [
      contribution('f-a', { fighterName: 'Alice', leaguePoints: 30 }),
      contribution('f-b', { fighterName: 'Bob', leaguePoints: 20 }),
      contribution('f-c', { fighterName: 'Carol', leaguePoints: 20 }),
      contribution('f-d', { fighterName: 'Dan', leaguePoints: 10 }),
    ]);

    // Standard competition numbering: 1, 2, 2, 4 -- not 1, 2, 3, 4.
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 2, 4]);
  });

  it('does not share a rank when a later chain key separates them', () => {
    const rows = computeRankingsFromContributions(
      { tieBreakers: ['total_points', 'medal_count'] },
      [
        contribution('f-a', { fighterName: 'Alice', leaguePoints: 20, medal: 'gold' }),
        contribution('f-b', { fighterName: 'Bob', leaguePoints: 20 }),
      ],
    );

    expect(rows.map((row) => row.rank)).toEqual([1, 2]);
  });

  it('prefers the LOWER double-hit average, unlike every other tie-breaker', () => {
    const rows = computeRankingsFromContributions(baseConfig, [
      contribution('f-a', { fighterName: 'Alice', leaguePoints: 16, doubleHits: 4 }),
      contribution('f-b', { fighterName: 'Bob', leaguePoints: 16, doubleHits: 1 }),
    ]);

    expect(rows.map((row) => row.fighterId)).toEqual(['f-b', 'f-a']);
  });

  it('honours the configured chain ORDER, not a fixed one', () => {
    // Alice has more points; Bob has more participations. Which one leads
    // depends entirely on which key the organiser put first.
    const rows = (order: LeagueScoringConfig['tieBreakers']) =>
      computeRankingsFromContributions({ tieBreakers: order }, [
        contribution('f-a', { fighterName: 'Alice', tournamentId: 't1', leaguePoints: 30 }),
        contribution('f-b', { fighterName: 'Bob', tournamentId: 't1', leaguePoints: 10 }),
        contribution('f-b', { fighterName: 'Bob', tournamentId: 't2', leaguePoints: 10 }),
      ]).map((row) => row.fighterId);

    expect(rows(['total_points', 'participation_count'])).toEqual(['f-a', 'f-b']);
    expect(rows(['participation_count', 'total_points'])).toEqual(['f-b', 'f-a']);
  });
});

describe('tiedOnChain', () => {
  it('reports a real tie where compareRankings never can', () => {
    const [alice, bob] = computeRankingsFromContributions({ tieBreakers: ['total_points'] }, [
      contribution('f-a', { fighterName: 'Alice', leaguePoints: 10 }),
      contribution('f-b', { fighterName: 'Bob', leaguePoints: 10 }),
    ]);

    expect(tiedOnChain(alice!, bob!, ['total_points'])).toBe(true);
    // The sort comparator ends in the fighter name, so it separates them even
    // though nothing the organiser configured does. That difference is the
    // whole reason both functions exist.
    expect(compareRankings(alice!, bob!, ['total_points'])).not.toBe(0);
  });

  it('an empty chain makes everyone tied', () => {
    const [alice, bob] = computeRankingsFromContributions({ tieBreakers: [] }, [
      contribution('f-a', { fighterName: 'Alice', leaguePoints: 30 }),
      contribution('f-b', { fighterName: 'Bob', leaguePoints: 10 }),
    ]);

    expect(tiedOnChain(alice!, bob!, [])).toBe(true);
  });

  it('the inverted double-hit key separates as readily as the rest', () => {
    const [low, high] = computeRankingsFromContributions({ tieBreakers: ['double_hit_average'] }, [
      contribution('f-a', { fighterName: 'Alice', doubleHits: 1 }),
      contribution('f-b', { fighterName: 'Bob', doubleHits: 4 }),
    ]);

    expect(tiedOnChain(low!, high!, ['double_hit_average'])).toBe(false);
    expect(tiedOnChain(low!, high!, ['total_points'])).toBe(true);
  });
});

describe('compareRankings', () => {
  it('ignores a key the organiser left out of the chain', () => {
    const alice = computeRankingsFromContributions({ tieBreakers: ['total_points'] }, [
      contribution('f-a', { fighterName: 'Alice', leaguePoints: 10, medal: 'gold' }),
    ])[0]!;
    const bob = computeRankingsFromContributions({ tieBreakers: ['total_points'] }, [
      contribution('f-b', { fighterName: 'Bob', leaguePoints: 10 }),
    ])[0]!;

    // Alice has a medal, Bob does not, and they are level on points.
    expect(compareRankings(alice, bob, ['medal_count'])).toBeLessThan(0);
    // Drop medal_count from the chain and that difference stops counting.
    // Nothing else separates them, so the comparison falls through to the
    // terminal fighter-name key -- which is why this returns non-zero rather
    // than reporting a tie.
    expect(compareRankings(alice, bob, ['total_points'])).not.toBe(0);
  });

  it('never reports two DIFFERENT fighters as tied, whatever the chain says', () => {
    // The chain always ends in fighterName then fighterId, so a 0 means the
    // same fighter twice. Callers that branch on `=== 0` to share a rank number
    // should know that is the only case that reaches them.
    const rows = computeRankingsFromContributions({ tieBreakers: [] }, [
      contribution('f-a', { fighterName: 'Alice', leaguePoints: 10 }),
      contribution('f-b', { fighterName: 'Bob', leaguePoints: 10 }),
    ]);

    expect(compareRankings(rows[0]!, rows[1]!, [])).not.toBe(0);
    expect(compareRankings(rows[0]!, rows[0]!, [])).toBe(0);
  });
});

describe('medalFor', () => {
  it('follows the real podium for a bracket result', () => {
    expect(medalFor('champion', 1)).toBe('gold');
    expect(medalFor('runnerUp', 2)).toBe('silver');
    expect(medalFor('third', 3)).toBe('bronze');
  });

  it('gives no medal to a semi-final loser placed third with no bronze match', () => {
    expect(medalFor('round', 3)).toBeNull();
    expect(medalFor('fourth', 4)).toBeNull();
  });

  it('falls back to the place when the finish is rank-only', () => {
    expect(medalFor(undefined, 1)).toBe('gold');
    expect(medalFor('pool', 2)).toBe('silver');
    expect(medalFor('swiss', 3)).toBe('bronze');
    expect(medalFor(undefined, 4)).toBeNull();
  });
});
