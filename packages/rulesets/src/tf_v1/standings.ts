/**
 * packages/rulesets/src/tf_v1/standings.ts
 *
 * TF_v1 pool standings computation — pure function, no I/O.
 * Implements ARCHITECTURE.md §6.1, §6.2, §6.3 exactly.
 */
import type { AfterblowMode } from '../match-format';
import type { Exchange, Match, Pool, PoolStandingRow, Registration } from '../types';
import type { TFv1Config } from './config';
import { computeAggregates, computeScore } from './score';

/**
 * Compute TF_v1 pool standings.
 *
 * Tiebreakers (ARCHITECTURE.md §6.3):
 *   1. SCORE descending
 *   2. wins descending
 *   3. doubles ascending
 *   4. timesHit ascending
 *   5. seed ascending (bib_number as fallback)
 */
export function computePoolStandings(
  _pool: Pool,
  matches: Match[],
  registrations: Registration[],
  config: TFv1Config,
  afterblowMode: AfterblowMode = 'full',
): PoolStandingRow[] {
  // Build a map of all exchanges per match
  // (In this pure function, exchanges are passed via matches — see index.ts)
  // We work with the matches array directly.

  // Aggregate stats per registration
  const stats = new Map<
    string,
    { wins: number; targetPoints: number; timesHit: number; doubles: number }
  >();

  for (const reg of registrations) {
    stats.set(reg.id, { wins: 0, targetPoints: 0, timesHit: 0, doubles: 0 });
  }

  // Process each completed match
  for (const match of matches) {
    if (match.status !== 'completed') continue;

    const matchExchanges = (match as Match & { exchanges?: Exchange[] }).exchanges ?? [];

    // Determine winner — stored on match (set by organizer/referee at match end)
    const winnerId = (match as Match & { winnerRegistrationId?: string }).winnerRegistrationId;

    for (const regId of [match.redRegistrationId, match.blueRegistrationId]) {
      if (!stats.has(regId)) continue;

      const agg = computeAggregates(
        regId,
        match,
        matchExchanges,
        winnerId === regId,
        afterblowMode,
      );

      const current = stats.get(regId)!;
      current.wins += agg.wins;
      current.targetPoints += agg.targetPoints;
      current.timesHit += agg.timesHit;
      current.doubles += agg.doubles;
    }
  }

  // Build rows with scores
  const rows: Array<PoolStandingRow & { seed: number | null }> = registrations.map((reg) => {
    const agg = stats.get(reg.id) ?? { wins: 0, targetPoints: 0, timesHit: 0, doubles: 0 };
    return {
      registrationId: reg.id,
      rank: 0, // assigned after sort
      wins: agg.wins,
      targetPoints: agg.targetPoints,
      timesHit: agg.timesHit,
      doubles: agg.doubles,
      // winBonus / doublePenaltyFormula come from the ruleset config. They were
      // hardcoded, so a super-admin amending the federal rulebook changed a
      // stored value the engine never read.
      score: computeScore(agg, {
        winBonus: config.winBonus,
        doublePenaltyFormula: config.doublePenaltyFormula,
      }),
      seed: reg.seed ?? reg.bibNumber ?? null,
    };
  });

  // Sort by tiebreakers (ARCHITECTURE.md §6.3)
  rows.sort((a, b) => {
    // 1. Score descending
    if (b.score !== a.score) return b.score - a.score;
    // 2. Wins descending
    if (b.wins !== a.wins) return b.wins - a.wins;
    // 3. Doubles ascending
    if (a.doubles !== b.doubles) return a.doubles - b.doubles;
    // 4. TimesHit ascending
    if (a.timesHit !== b.timesHit) return a.timesHit - b.timesHit;
    // 5. Seed ascending (stable)
    const seedA = a.seed ?? Infinity;
    const seedB = b.seed ?? Infinity;
    return seedA - seedB;
  });

  // Assign ranks (1-indexed)
  rows.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  return rows.map(({ seed: _seed, ...row }) => row);
}
