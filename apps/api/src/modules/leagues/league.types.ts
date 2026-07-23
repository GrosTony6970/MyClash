import type { FinalRankingResultKind } from '@myclash/types';

/**
 * Stored on `leagues.scoring_system`. The literals 'ffamhe_tf_2026' and
 * 'custom' are the legacy hard-coded values; any other lowercase code is
 * a reference into the `league_scoring_systems` registry (migration 0068).
 */
export type LeagueScoringSystem = 'ffamhe_tf_2026' | 'custom' | (string & {});
export type LeagueRankingDimensions = 'weapon' | 'weapon_category';
export type LeagueTieBreaker =
  | 'total_points'
  | 'participation_count'
  | 'medal_count'
  | 'double_hit_average';

export interface LeagueScoringConfig {
  scoringSystem: LeagueScoringSystem;
  rankingDimensions: LeagueRankingDimensions;
  customPointsByRank?: Record<number, number>;
  tieBreakers: LeagueTieBreaker[];
}

export interface TournamentContributionInput {
  leagueId: string;
  tournamentId: string;
  eventId: string;
  fighterId: string | null;
  fighterName: string;
  clubName: string | null;
  clubCity: string | null;
  weapon: string | null;
  /** League-defined group name (from league_groups). Replaces tournament.category. */
  groupName: string | null;
  finalRank: number;
  /** How this fighter finished, from the shared `computeFinalRanking`. Drives the
   *  medal: champion/runnerUp/third → gold/silver/bronze, so a semi-final loser
   *  placed 3rd with no bronze match ('round') gets no phantom medal. Optional so
   *  callers that only know a rank (pool-only, legacy tests) fall back to
   *  rank 1/2/3 → medal. */
  resultKind?: FinalRankingResultKind;
  doubleHits: number;
}

export interface LeagueTournamentContribution {
  leagueId: string;
  tournamentId: string;
  eventId: string;
  fighterId: string;
  fighterName: string;
  clubName: string | null;
  clubCity: string | null;
  rankingGroupKey: string;
  weapon: string | null;
  groupName: string | null;
  finalRank: number;
  leaguePoints: number;
  medal: 'gold' | 'silver' | 'bronze' | null;
  doubleHits: number;
}

export interface LeagueRankingRow {
  leagueId: string;
  rankingGroupKey: string;
  fighterId: string;
  fighterName: string;
  clubName: string | null;
  clubCity: string | null;
  rank: number;
  totalPoints: number;
  participationCount: number;
  medalCount: number;
  doubleHitsTotal: number;
  doubleHitAverage: number;
  perTournament: Array<{
    tournamentId: string;
    eventId: string;
    finalRank: number;
    leaguePoints: number;
  }>;
}

export const DEFAULT_LEAGUE_SCORING_CONFIG: LeagueScoringConfig = {
  scoringSystem: 'ffamhe_tf_2026',
  rankingDimensions: 'weapon',
  tieBreakers: ['total_points', 'participation_count', 'medal_count', 'double_hit_average'],
};
