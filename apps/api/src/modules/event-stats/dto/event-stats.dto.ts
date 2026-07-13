/**
 * event-stats.dto.ts
 *
 * Response shapes for the organizer event-statistics surface. The main endpoint
 * returns an event-wide rollup + per-tournament summaries (small) + an
 * event-wide referee-workload leaderboard. The heavy per-fighter exchange table
 * + overall standings are fetched on demand per tournament (detail endpoint) so
 * the initial page load stays snappy for large events.
 */

import type { StandingsColumn } from '@myclash/rulesets';
import type { FighterExchangeStats } from '../../stats/stats.service';

/** One podium finisher (top of the final ranking). */
export interface EventStatsPodiumEntry {
  place: number;
  fighterName: string;
  club: string | null;
}

/** A collapsed per-tournament card's headline data (no big tables). */
export interface TournamentStatSummary {
  id: string;
  name: string;
  slug: string;
  weapon: string | null;
  color: string | null;
  status: string;
  participantCount: number;
  matchCount: number;
  completedMatchCount: number;
  completionPercent: number;
  exchangeCount: number;
  doublesCount: number;
  doublesPercent: number;
  clubCount: number;
  podium: EventStatsPodiumEntry[];
  topFighters: Array<{ name: string; club: string | null; hitRatio: number | null }>;
}

/** Event-wide rollup shown in the top stat band. */
export interface EventStatsRollup {
  id: string;
  name: string | null;
  slug: string | null;
  tournamentCount: number;
  participantCount: number;
  /** Distinct people with an active registration (deduped across tournaments). */
  uniqueFighters: number;
  /** Distinct qualified referees for the event. */
  uniqueReferees: number;
  matchCount: number;
  completedMatchCount: number;
  completionPercent: number;
  exchangeCount: number;
  doublesCount: number;
  doublesPercent: number;
  clubCount: number;
}

/** One referee's workload across the whole event. */
export interface RefereeWorkloadRow {
  personId: string;
  name: string;
  matchesReffed: number;
  roles: { arbitre_declarant: number; arbitre_assesseur: number; arbitre_table: number };
  cards: { yellow: number; red: number; black: number };
  averageRefereeTimeMs: number;
}

export interface EventStatisticsResponse {
  event: EventStatsRollup;
  tournaments: TournamentStatSummary[];
  referees: RefereeWorkloadRow[];
}

/** Lazy per-tournament detail: overall standings + full per-fighter blow table. */
export interface TournamentStatsDetailResponse {
  tournamentId: string;
  standings: {
    columns: StandingsColumn[];
    rows: Array<{
      rank: number;
      registrationId: string;
      displayName: string;
      club: { id: string; name: string; abbreviation: string | null } | null;
      stats: Record<string, number | string>;
    }>;
  };
  fighters: FighterExchangeStats[];
}
