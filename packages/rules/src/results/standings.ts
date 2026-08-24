/**
 * The single ordering authority for standings, and the reason a fighter sits
 * where they do.
 *
 * Was `apps/api/src/modules/pool-standings/standings-rows.ts`. `PoolWithMembers`
 * did NOT come with it: that interface is a PostgREST embed shape
 * (`pool_members`, `registration_id`, `persons`, `clubs`), and a database row
 * shape crossing into the deterministic core is what the seam exists to stop.
 * It stays in the API adapter as `pool-rows.ts`.
 */
import type { RankingRule } from '../ranking';

/**
 * Why this fighter is ranked below the one directly above them: the first
 * rankingChain key on which their values differ, plus both values so a fighter
 * page can render "placed below X on doubles (2 vs 4)". `direction` tells the
 * reader which way is better for that key.
 */
export interface DecidingTiebreak {
  key: string;
  direction: 'asc' | 'desc';
  mine: number;
  theirs: number;
}

export interface StandingsRow {
  rank: number;
  registrationId: string;
  displayName: string;
  club: { id: string; name: string; abbreviation: string | null } | null;
  status: 'in_progress' | 'completed';
  stats: Record<string, number | string>;
  /**
   * The rankingChain key that separated this fighter from the one directly
   * above them, computed by `applyRanking`. `null` for the leader and for a
   * fighter tied with the one above on every chain key. Optional so callers
   * that build rows before ranking need not set it.
   */
  decidingTiebreak?: DecidingTiebreak | null;
}

/**
 * The single ordering authority for standings.
 *
 * Rulesets sort internally inside computePoolStandings, but that ordering is
 * discarded: it is per-pool, whereas the "overall" view flattens every pool and
 * must rank them together. Ranking here — over the rendered columns, driven by
 * the ruleset's declared `rankingChain` — keeps both views consistent, which is
 * why a FormulaRuleset projects the author's tiebreakers onto column keys.
 */
export function applyRanking(rows: StandingsRow[], rankingChain: RankingRule[]): StandingsRow[] {
  const sorted = [...rows].sort((a, b) => {
    for (const rule of rankingChain) {
      const av = Number(a.stats[rule.key] ?? 0);
      const bv = Number(b.stats[rule.key] ?? 0);
      if (av !== bv) {
        return rule.direction === 'desc' ? bv - av : av - bv;
      }
    }
    return 0;
  });
  return sorted.map((row, i) => ({
    ...row,
    rank: i + 1,
    decidingTiebreak: i === 0 ? null : decidingTiebreakBetween(sorted[i - 1]!, row, rankingChain),
  }));
}

/**
 * The rankingChain key that ordered `me` below `above` — the FIRST key on which
 * they differ, which is exactly the key the sort compared last. Returns null
 * when they match on every chain key (an exact tie). Runs over applyRanking's
 * own sorted output and chain, so overall and per-pool views agree.
 */
function decidingTiebreakBetween(
  above: StandingsRow,
  me: StandingsRow,
  rankingChain: RankingRule[],
): DecidingTiebreak | null {
  for (const rule of rankingChain) {
    const theirs = Number(above.stats[rule.key] ?? 0);
    const mine = Number(me.stats[rule.key] ?? 0);
    if (mine !== theirs) return { key: rule.key, direction: rule.direction, mine, theirs };
  }
  return null;
}
