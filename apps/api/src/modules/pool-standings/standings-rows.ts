import type { RankingRule } from '@myclash/rulesets';

export interface StandingsRow {
  rank: number;
  registrationId: string;
  displayName: string;
  club: { id: string; name: string; abbreviation: string | null } | null;
  status: 'in_progress' | 'completed';
  stats: Record<string, number | string>;
}

/** A pool with its members, as embedded by the pools select. */
export interface PoolWithMembers {
  id: string;
  name: string;
  pool_members: Array<{
    registration_id: string;
    registrations: {
      id: string;
      persons: {
        id: string;
        given_name: string;
        family_name: string;
        clubs: { id: string; name: string; abbreviation: string | null } | null;
      };
    };
  }>;
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
  return sorted.map((row, i) => ({ ...row, rank: i + 1 }));
}
