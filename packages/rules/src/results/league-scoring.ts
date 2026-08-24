/**
 * The League's scoring maths: points for a place, which table a result belongs
 * in, and the standings those results add up to.
 *
 * Extracted from `apps/api`'s `LeagueScoringService`, which keeps the one method
 * that does I/O (`resolveConfig`, a lookup into the `league_scoring_systems`
 * registry) and the one that throws a Nest exception
 * (`validateContributionIdentities`). The class now delegates here rather than
 * implementing; its public methods are unchanged, so no caller moved.
 *
 * The class was already shaped for this — its constructor comment said Supabase
 * was optional "so existing unit tests that instantiate LeagueScoringService
 * with no args (pure scoring math) keep working".
 */
import type { FinalRankingResultKind } from '../ranking';
import type {
  LeagueRankingRow,
  LeagueScoringConfig,
  LeagueTieBreaker,
  LeagueTournamentContribution,
  TournamentContributionInput,
} from './league-types';

/** Legacy hard-coded FFAMHE TF 2026 table — used as last-resort fallback when
 *  the registry row is missing AND the league config never embedded a points
 *  table. Mirrors the seed in migration 0068. */
export const FALLBACK_FFAMHE_2026: Record<number, number> = {
  1: 16,
  2: 13,
  3: 11,
  4: 10,
  5: 9,
  6: 8,
  7: 7,
  8: 6,
  9: 5,
  10: 4,
  11: 3,
  12: 2,
  13: 1,
  14: 1,
  15: 1,
  16: 1,
};

export function pointsForRank(config: LeagueScoringConfig, finalRank: number): number {
  if (!Number.isInteger(finalRank) || finalRank < 1) return 0;
  if (config.customPointsByRank) {
    return Math.max(0, Number(config.customPointsByRank[finalRank] ?? 0));
  }
  if (config.scoringSystem === 'custom') return 0;
  if (config.scoringSystem === 'ffamhe_tf_2026') {
    return FALLBACK_FFAMHE_2026[finalRank] ?? 0;
  }
  return 0;
}

export function groupKey(
  config: LeagueScoringConfig,
  contribution: TournamentContributionInput,
): string {
  const weapon = normalizeDimension(contribution.weapon);
  const group = normalizeDimension(contribution.groupName);
  if (config.rankingDimensions === 'weapon') return weapon;
  // The group alone: for a league whose divisions are the thing being ranked,
  // where a fighter's results across weapons belong in one table.
  if (config.rankingDimensions === 'group') return group;
  // 'weapon_category' historically meant weapon + category; it now
  // means weapon + league group (replacing tournament.category).
  return `${weapon}::${group}`;
}

export function computeRankingsFromContributions(
  config: Pick<LeagueScoringConfig, 'tieBreakers'>,
  contributions: LeagueTournamentContribution[],
): LeagueRankingRow[] {
  const byFighter = new Map<string, LeagueRankingRow>();

  for (const contribution of contributions) {
    const key = `${contribution.rankingGroupKey}:${contribution.fighterId}`;
    const row =
      byFighter.get(key) ??
      ({
        leagueId: contribution.leagueId,
        rankingGroupKey: contribution.rankingGroupKey,
        fighterId: contribution.fighterId,
        fighterName: contribution.fighterName,
        clubName: contribution.clubName,
        clubCity: contribution.clubCity,
        rank: 0,
        totalPoints: 0,
        participationCount: 0,
        medalCount: 0,
        doubleHitsTotal: 0,
        doubleHitAverage: 0,
        perTournament: [],
      } satisfies LeagueRankingRow);

    row.totalPoints += contribution.leaguePoints;
    row.participationCount += 1;
    row.medalCount += contribution.medal ? 1 : 0;
    row.doubleHitsTotal += contribution.doubleHits;
    row.doubleHitAverage =
      row.participationCount > 0 ? row.doubleHitsTotal / row.participationCount : 0;
    row.perTournament.push({
      tournamentId: contribution.tournamentId,
      eventId: contribution.eventId,
      finalRank: contribution.finalRank,
      leaguePoints: contribution.leaguePoints,
    });
    byFighter.set(key, row);
  }

  const rows = [...byFighter.values()].sort((a, b) => compareRankings(a, b, config.tieBreakers));
  let previous: LeagueRankingRow | null = null;
  rows.forEach((row, index) => {
    row.rank =
      previous && compareRankings(previous, row, config.tieBreakers) === 0
        ? previous.rank
        : index + 1;
    previous = row;
  });
  return rows;
}

export function compareRankings(
  a: LeagueRankingRow,
  b: LeagueRankingRow,
  tieBreakers: LeagueTieBreaker[],
): number {
  for (const tieBreaker of tieBreakers) {
    if (tieBreaker === 'total_points' && a.totalPoints !== b.totalPoints) {
      return b.totalPoints - a.totalPoints;
    }
    if (tieBreaker === 'participation_count' && a.participationCount !== b.participationCount) {
      return b.participationCount - a.participationCount;
    }
    if (tieBreaker === 'medal_count' && a.medalCount !== b.medalCount) {
      return b.medalCount - a.medalCount;
    }
    if (tieBreaker === 'double_hit_average' && a.doubleHitAverage !== b.doubleHitAverage) {
      return a.doubleHitAverage - b.doubleHitAverage;
    }
  }
  return a.fighterName.localeCompare(b.fighterName) || a.fighterId.localeCompare(b.fighterId);
}

function normalizeDimension(value: string | null | undefined): string {
  return (
    (value ?? 'unknown')
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'unknown'
  );
}

/**
 * Medal from the tournament finish. Bracket results follow the real podium:
 * champion/runnerUp/third → gold/silver/bronze, and a semi-final loser placed
 * 3rd/4th WITHOUT a bronze match ('round'/'fourth') earns no medal. Pool-only
 * tournaments ('pool') and legacy/rank-only inputs (resultKind undefined) fall
 * back to place 1/2/3 → gold/silver/bronze.
 */
export function medalFor(
  resultKind: FinalRankingResultKind | undefined,
  rank: number,
): LeagueTournamentContribution['medal'] {
  if (resultKind === 'champion') return 'gold';
  if (resultKind === 'runnerUp') return 'silver';
  if (resultKind === 'third') return 'bronze';
  if (resultKind === 'fourth' || resultKind === 'round') return null;
  if (rank === 1) return 'gold';
  if (rank === 2) return 'silver';
  if (rank === 3) return 'bronze';
  return null;
}
