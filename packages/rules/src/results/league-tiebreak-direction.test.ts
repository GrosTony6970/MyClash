import { describe, expect, it } from 'vitest';
import { compareRankings } from './league-scoring';
import { TIEBREAK_DIRECTION } from './league-standings-rows';
import type { LeagueRankingRow, LeagueTieBreaker } from './league-types';

/**
 * `TIEBREAK_DIRECTION` tells the public standings which way is better for each
 * key, so it can render "edged out on medals (2 vs 1)" the right way round. Its
 * docblock says it "must match the comparison semantics of `compareRankings`",
 * and nothing checked that: the two live in different modules and the only thing
 * pairing them was the sentence.
 *
 * This drives the real comparator with two rows differing in exactly ONE key and
 * reads back which way it sorts, rather than restating the table a third time.
 */

/** The row field each tie-breaker key reads. */
const FIELD: Record<LeagueTieBreaker, keyof LeagueRankingRow> = {
  total_points: 'totalPoints',
  participation_count: 'participationCount',
  medal_count: 'medalCount',
  double_hit_average: 'doubleHitAverage',
};

function row(overrides: Partial<LeagueRankingRow>): LeagueRankingRow {
  return {
    leagueId: 'league-1',
    rankingGroupKey: 'longsword',
    fighterId: 'f-a',
    fighterName: 'Same Name',
    clubName: null,
    clubCity: null,
    rank: 0,
    totalPoints: 0,
    participationCount: 0,
    medalCount: 0,
    doubleHitsTotal: 0,
    doubleHitAverage: 0,
    perTournament: [],
    ...overrides,
  };
}

describe('TIEBREAK_DIRECTION against compareRankings', () => {
  const keys = Object.keys(TIEBREAK_DIRECTION) as LeagueTieBreaker[];

  it('covers every key the type allows and no more', () => {
    // If a fifth tie-breaker is added, this list must grow with it — otherwise
    // the loop below would quietly stop checking the new one.
    expect(keys.sort()).toEqual((Object.keys(FIELD) as LeagueTieBreaker[]).sort());
    expect(keys.length).toBeGreaterThan(0);
  });

  for (const key of keys) {
    it(`sorts ${key} the way TIEBREAK_DIRECTION says (${TIEBREAK_DIRECTION[key]})`, () => {
      // Identical rows but for this one key, and identical names/ids so the
      // terminal ordering key cannot decide it instead.
      const higher = row({ [FIELD[key]]: 2 } as Partial<LeagueRankingRow>);
      const lower = row({ [FIELD[key]]: 1 } as Partial<LeagueRankingRow>);

      const higherComesFirst = compareRankings(higher, lower, [key]) < 0;

      expect(
        higherComesFirst,
        `${key}: TIEBREAK_DIRECTION says ${TIEBREAK_DIRECTION[key]}, so a higher value must sort ${
          TIEBREAK_DIRECTION[key] === 'desc' ? 'first' : 'last'
        }`,
      ).toBe(TIEBREAK_DIRECTION[key] === 'desc');
    });
  }
});
