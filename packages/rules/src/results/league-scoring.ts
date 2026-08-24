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
import { byCodepoint } from './by-codepoint';
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

  // Number each ranking group on its own. A league's rankingDimensions decide
  // how many tables it has -- one per weapon by default -- and each table is a
  // separate competition with its own winner. Numbering the whole set in one
  // pass gave the sidesword champion rank 3 because two longsword fighters
  // scored higher, and the public page picks champions with `rank === 1`, so
  // every table but the strongest showed no champion at all.
  const byGroup = new Map<string, LeagueRankingRow[]>();
  for (const row of byFighter.values()) {
    const group = byGroup.get(row.rankingGroupKey);
    if (group) group.push(row);
    else byGroup.set(row.rankingGroupKey, [row]);
  }

  const ranked: LeagueRankingRow[] = [];
  for (const groupKey of [...byGroup.keys()].sort()) {
    const rows = byGroup.get(groupKey)!.sort((a, b) => compareRankings(a, b, config.tieBreakers));

    let previous: LeagueRankingRow | null = null;
    let previousRank = 0;
    rows.forEach((row, index) => {
      // Standard competition numbering: two fighters level on every configured
      // key share a place and the next one down skips it (1, 2, 2, 4).
      const rank =
        previous && tiedOnChain(previous, row, config.tieBreakers) ? previousRank : index + 1;
      row.rank = rank;
      previous = row;
      previousRank = rank;
    });
    ranked.push(...rows);
  }

  return ranked;
}

/**
 * Are these two level on every tie-breaker the organiser configured?
 *
 * Deliberately NOT `compareRankings(...) === 0`. That function ends in a
 * fighter-name then fighter-id comparison so the sort is deterministic, which
 * means it returns 0 only for the same fighter twice -- so the shared-rank
 * branch above could never fire, and every tie was silently broken by
 * alphabetical order with no indication to the reader.
 *
 * This is the same notion of a tie the READ side already used:
 * `decidingTiebreakBetween` walks the configured chain alone and returns null
 * when nothing separates two fighters. The two now agree.
 */
export function tiedOnChain(
  a: LeagueRankingRow,
  b: LeagueRankingRow,
  tieBreakers: readonly LeagueTieBreaker[],
): boolean {
  for (const tieBreaker of tieBreakers) {
    if (tieBreaker === 'total_points' && a.totalPoints !== b.totalPoints) return false;
    if (tieBreaker === 'participation_count' && a.participationCount !== b.participationCount) {
      return false;
    }
    if (tieBreaker === 'medal_count' && a.medalCount !== b.medalCount) return false;
    if (tieBreaker === 'double_hit_average' && a.doubleHitAverage !== b.doubleHitAverage) {
      return false;
    }
  }
  return true;
}

/**
 * Total order over two ranked rows, for SORTING only.
 *
 * The trailing fighter-name / fighter-id comparison makes the sort stable and
 * reproducible, and it also means this never reports two different fighters as
 * equal. Ask `tiedOnChain` whether two fighters are actually level; a
 * `compareRankings(...) === 0` test answers a different question.
 */
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
  return byCodepoint(a.fighterName, b.fighterName) || byCodepoint(a.fighterId, b.fighterId);
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
