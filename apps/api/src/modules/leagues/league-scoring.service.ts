import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  LeagueRankingRow,
  LeagueScoringConfig,
  LeagueTieBreaker,
  LeagueTournamentContribution,
  TournamentContributionInput,
} from './league.types';

/** Legacy hard-coded FFAMHE TF 2026 table — used as last-resort fallback when
 *  the registry row is missing AND the league config never embedded a points
 *  table. Mirrors the seed in migration 0068. */
const FALLBACK_FFAMHE_2026: Record<number, number> = {
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

@Injectable()
export class LeagueScoringService {
  // SupabaseService is optional so existing unit tests that instantiate
  // LeagueScoringService with no args (pure scoring math) keep working.
  constructor(private readonly supabase?: SupabaseService) {}

  pointsForRank(config: LeagueScoringConfig, finalRank: number): number {
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

  /**
   * Hydrate a league scoring config by resolving its `scoringSystem` code
   * against the `league_scoring_systems` registry (migration 0068). Returns
   * a copy with `customPointsByRank` and `tieBreakers` filled in from the
   * preset when applicable. Per-league `'custom'` configs are returned
   * unchanged. Unknown / archived codes also pass through (caller falls
   * back to the hard-coded table via `pointsForRank`).
   */
  async resolveConfig(config: LeagueScoringConfig): Promise<LeagueScoringConfig> {
    if (config.scoringSystem === 'custom') return config;
    if (config.customPointsByRank) return config;
    if (!this.supabase) return config;

    const { data, error } = await this.supabase.service
      .from('league_scoring_systems')
      .select('points_by_rank, tie_breakers')
      .eq('code', config.scoringSystem)
      .eq('is_archived', false)
      .maybeSingle();
    if (error || !data) return config;

    const raw = (data as { points_by_rank?: Record<string, number> }).points_by_rank ?? {};
    const pointsByRank: Record<number, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      const rank = Number(k);
      const pts = Number(v);
      if (Number.isInteger(rank) && Number.isFinite(pts)) {
        pointsByRank[rank] = Math.max(0, Math.round(pts));
      }
    }
    const tieBreakersRaw = (data as { tie_breakers?: string[] }).tie_breakers;
    const tieBreakers =
      Array.isArray(tieBreakersRaw) && tieBreakersRaw.length > 0
        ? (tieBreakersRaw as LeagueTieBreaker[])
        : config.tieBreakers;

    return { ...config, customPointsByRank: pointsByRank, tieBreakers };
  }

  groupKey(config: LeagueScoringConfig, contribution: TournamentContributionInput): string {
    const weapon = normalizeDimension(contribution.weapon);
    if (config.rankingDimensions === 'weapon') return weapon;
    // 'weapon_category' historically meant weapon + category; it now
    // means weapon + league group (replacing tournament.category).
    return `${weapon}::${normalizeDimension(contribution.groupName)}`;
  }

  validateContributionIdentities(contributions: TournamentContributionInput[]): void {
    const missing = contributions.filter((row) => !row.fighterId);
    if (missing.length === 0) return;

    const names = missing
      .map((row) => row.fighterName)
      .filter(Boolean)
      .slice(0, 5)
      .join(', ');
    throw new BadRequestException(
      `League calculation requires global Fighter links for every registration. Missing: ${names}`,
    );
  }

  toTournamentContributions(
    config: LeagueScoringConfig,
    inputs: TournamentContributionInput[],
  ): LeagueTournamentContribution[] {
    this.validateContributionIdentities(inputs);

    return inputs.map((input) => {
      const finalRank = Number(input.finalRank);
      return {
        leagueId: input.leagueId,
        tournamentId: input.tournamentId,
        eventId: input.eventId,
        fighterId: input.fighterId!,
        fighterName: input.fighterName,
        clubName: input.clubName,
        clubCity: input.clubCity,
        rankingGroupKey: this.groupKey(config, input),
        weapon: input.weapon,
        groupName: input.groupName,
        finalRank,
        leaguePoints: this.pointsForRank(config, finalRank),
        medal: medalForRank(finalRank),
        doubleHits: Math.max(0, Number(input.doubleHits) || 0),
      };
    });
  }

  computeRankings(
    config: LeagueScoringConfig,
    inputs: TournamentContributionInput[],
  ): LeagueRankingRow[] {
    const contributions = this.toTournamentContributions(config, inputs);
    return this.computeRankingsFromContributions(config, contributions);
  }

  computeRankingsFromContributions(
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
}

function compareRankings(
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

function medalForRank(rank: number): LeagueTournamentContribution['medal'] {
  if (rank === 1) return 'gold';
  if (rank === 2) return 'silver';
  if (rank === 3) return 'bronze';
  return null;
}
