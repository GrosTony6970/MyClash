/**
 * FE shapes for the organizer event-statistics surface. Mirror the API DTOs in
 * apps/api/src/modules/event-stats/dto/event-stats.dto.ts (kept in sync by hand,
 * matching the repo convention of per-app interface declarations).
 */

export interface PodiumEntry {
  place: number;
  fighterName: string;
  club: string | null;
}

export interface TopFighter {
  name: string;
  club: string | null;
  hitRatio: number | null;
}

export interface TournamentSummary {
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
  podium: PodiumEntry[];
  topFighters: TopFighter[];
}

export interface EventRollup {
  id: string;
  name: string | null;
  slug: string | null;
  tournamentCount: number;
  participantCount: number;
  uniqueFighters: number;
  uniqueReferees: number;
  matchCount: number;
  completedMatchCount: number;
  completionPercent: number;
  exchangeCount: number;
  doublesCount: number;
  doublesPercent: number;
  clubCount: number;
}

export interface RefereeWorkloadRow {
  personId: string;
  name: string;
  matchesReffed: number;
  roles: { arbitre_declarant: number; arbitre_assesseur: number; arbitre_table: number };
  cards: { yellow: number; red: number; black: number };
  averageRefereeTimeMs: number;
}

export interface EventStatistics {
  event: EventRollup;
  tournaments: TournamentSummary[];
  referees: RefereeWorkloadRow[];
}

/** Per-fighter blow breakdown (lyonamhe.fr layout). */
export interface FighterStats {
  registrationId: string;
  givenName: string;
  familyName: string;
  clubName: string | null;
  doubles: number;
  hitsGiven1: number;
  afterblowGiven1: number;
  hitsGiven2: number;
  afterblowGiven2: number;
  hitsReceived1: number;
  afterblowReceived1: number;
  hitsReceived2: number;
  afterblowReceived2: number;
  blowsGiven: number;
  blowsReceived: number;
  totalExchanges: number;
  hitRatio: number | null;
  pointRatio: number | null;
}

export interface StandingsColumn {
  key: string;
  label: string;
}

export interface StandingsRow {
  rank: number;
  registrationId: string;
  displayName: string;
  club: { id: string; name: string; abbreviation: string | null } | null;
  stats: Record<string, number | string>;
}

export interface TournamentDetail {
  tournamentId: string;
  standings: { columns: StandingsColumn[]; rows: StandingsRow[] };
  fighters: FighterStats[];
}
