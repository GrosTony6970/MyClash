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
    // No declared key separates them. This used to return 0 and fall to input
    // order, which is whatever PostgREST happened to return -- so two exactly
    // level fighters could swap places between two reads of the same pool. That
    // is not only a display wobble: pool rank feeds bracket promotion.
    return (
      byCodepoint(a.displayName, b.displayName) || byCodepoint(a.registrationId, b.registrationId)
    );
  });
  return sorted.map((row, i) => ({
    ...row,
    rank: i + 1,
    decidingTiebreak: i === 0 ? null : decidingTiebreakBetween(sorted[i - 1]!, row, rankingChain),
  }));
}

/**
 * The terminal ordering key, compared by CODE POINT rather than by locale.
 *
 * `localeCompare` with no locale argument uses whatever the runtime's default
 * is, so the same pool could rank differently on a developer's machine and in
 * the API container: `'Ähtäri'.localeCompare('Zoe')` is -1 under `en` and +1
 * under `sv`. Code points have no ICU data behind them, so they cannot drift
 * with a Node upgrade either. Same reasoning, and the same helper, as the
 * League's `compareRankings`.
 *
 * The cost is that accented names sort after `Z` and capitals before lowercase.
 * That is confined to fighters who are level on EVERY declared key, where the
 * order is presentation rather than placement.
 *
 * ── Why this is here and not on the chains ──────────────────────────────────
 * It orders, but it is deliberately NOT reported as a deciding tiebreak: see
 * `decidingTiebreakBetween` below, which still runs the declared chain alone.
 * Appending a terminal key to each ruleset's `rankingChain` instead would have
 * made every exact tie report a deciding key, and `SwissStandingsService` builds
 * its head-to-head tie blocks from `decidingTiebreak === null` -- so head-to-head
 * would have stopped firing entirely. One owner here also covers the chains an
 * organiser authors, which cannot be given a terminal key in advance.
 */
function byCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
