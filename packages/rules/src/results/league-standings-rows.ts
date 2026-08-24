import type { LeagueTieBreaker } from './league-types';

/**
 * Why this fighter is ranked below the one directly above them in the same
 * `ranking_group_key`: the first tie-breaker key on which their values differ,
 * plus both values so the public standings can render "edged out on medals
 * (2 vs 1)". `direction` tells the reader which way is better for that key.
 *
 * Mirrors the tournament-side `DecidingTiebreak` shape
 * (pool-standings/standings-rows.ts) so both surfaces explain a placement the
 * same way.
 */
export interface LeagueDecidingTiebreak {
  key: LeagueTieBreaker;
  direction: 'asc' | 'desc';
  mine: number;
  theirs: number;
}

/**
 * Which direction wins for each tie-breaker — must match the comparison
 * semantics of `compareRankings` in ./league-scoring.ts: more points /
 * participations / medals is better (desc); a *lower* double-hit average is
 * better (asc).
 */
const TIEBREAK_DIRECTION: Record<LeagueTieBreaker, 'asc' | 'desc'> = {
  total_points: 'desc',
  participation_count: 'desc',
  medal_count: 'desc',
  double_hit_average: 'asc',
};

type StandingsRankingRow = Record<string, unknown> & { ranking_group_key?: unknown };

/**
 * The tie-breaker enum values are exactly the `league_rankings` column names,
 * so a single lookup reads every criterion. `double_hit_average` is stored as a
 * numeric string; `Number()` normalizes it.
 */
function valueForKey(row: StandingsRankingRow, key: LeagueTieBreaker): number {
  return Number(row[key] ?? 0);
}

/**
 * The first tie-breaker key that ordered `me` below `above` — the FIRST key on
 * which they differ, walked in the league's configured tie-breaker order.
 * Returns null when they match on every key (an exact tie). Standalone + pure so
 * the derivation is unit-testable.
 */
export function decidingTiebreakBetween(
  above: StandingsRankingRow,
  me: StandingsRankingRow,
  tieBreakers: readonly LeagueTieBreaker[],
): LeagueDecidingTiebreak | null {
  for (const key of tieBreakers) {
    const theirs = valueForKey(above, key);
    const mine = valueForKey(me, key);
    if (mine !== theirs) return { key, direction: TIEBREAK_DIRECTION[key], mine, theirs };
  }
  return null;
}

/**
 * Attach a `decidingTiebreak` to every standings row, comparing each row to the
 * one directly above it. Rows must already be ordered by `ranking_group_key`
 * then `rank` (the standings query order): the leader of each group — and any
 * row whose predecessor is in a different group — gets null, since there is no
 * fighter above it to be separated from.
 */
export function attachDecidingTiebreaks<T extends StandingsRankingRow>(
  rows: T[],
  tieBreakers: readonly LeagueTieBreaker[],
): Array<T & { decidingTiebreak: LeagueDecidingTiebreak | null }> {
  return rows.map((row, index) => {
    const previous = index > 0 ? rows[index - 1]! : null;
    const sameGroup =
      previous != null &&
      String(previous.ranking_group_key ?? '') === String(row.ranking_group_key ?? '');
    return {
      ...row,
      decidingTiebreak: sameGroup ? decidingTiebreakBetween(previous, row, tieBreakers) : null,
    };
  });
}
