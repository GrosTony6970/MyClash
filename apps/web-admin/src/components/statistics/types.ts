/**
 * FE shapes for the organizer event-statistics surface. Mirror the API DTOs in
 * apps/api/src/modules/event-stats/dto/event-stats.dto.ts (kept in sync by hand,
 * matching the repo convention of per-app interface declarations).
 */

import type { AfterblowRule, BlowValueCounts } from '@myclash/ui';

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

/** Per-weapon point-value stats (deep-target hunters + point distribution). */
export interface WeaponTargetStats {
  weapon: string | null;
  maxValue: number | null;
  distribution: Array<{ value: number; cleanHits: number }>;
  hunters: Array<{ personId: string; name: string; club: string | null; cleanHits: number }>;
}

export interface EventStatistics {
  event: EventRollup;
  tournaments: TournamentSummary[];
  referees: RefereeWorkloadRow[];
  weaponBreakdown: WeaponTargetStats[];
}

/** Per-fighter blow breakdown (lyonamhe.fr layout). */
export interface FighterStats {
  registrationId: string;
  givenName: string;
  familyName: string;
  clubName: string | null;
  doubles: number;
  /**
   * Blow counts keyed by the point value that occurred, ascending. Twelve fixed
   * fields before (`hitsGiven1`..`afterblowReceived3`), so a target worth 4 or
   * more had nowhere to appear. See migration 0189.
   */
  byValue: BlowValueCounts[];
  blowsGiven: number;
  blowsReceived: number;
  totalExchanges: number;
  hitRatio: number | null;
  pointRatio: number | null;
}

export interface StandingsColumn {
  key: string;
  label: string;
  /** Natural sort direction from the ruleset (true = higher-is-better). */
  sortDesc?: boolean;
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
  /** The ruleset's afterblow valuation, for the blow table column headings. */
  afterblow: AfterblowRule;
}
