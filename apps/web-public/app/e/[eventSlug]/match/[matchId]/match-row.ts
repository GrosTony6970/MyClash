/**
 * Shared, framework-agnostic match data types + the snake_case→camelCase row
 * mapper. Lives OUTSIDE the `'use client'` view module so the server component
 * (page.tsx / generateMetadata) can call `mapMatchRow` directly — calling a
 * function exported from a `'use client'` module on the server throws under RSC.
 *
 * Pure: no React, no I/O.
 */

import type { MatchFormatConfig, PhaseType, TournamentScoringConfig } from '@myclash/types';
// The subpath, in this route's own chunk: the root barrel and `@myclash/ui` ship on every page.
import { sideKey } from '@myclash/types/side-key';
import type { ExchangeRow, ExchangeType, MatchProtest, Penalty } from '@myclash/ui';

// The exchange + penalty wire shapes are declared once in @myclash/ui
// (packages/ui/src/types/match-events.ts), because the shared timeline builder
// this page renders through needs them too. Re-exported under this module's
// long-standing names so the server page and the client view are unchanged.
// `export type` is required — isolatedModules is on.
export type { ExchangeRow, ExchangeType, MatchProtest };
export type MatchPenaltyRow = Penalty;

export type MatchStatus = 'scheduled' | 'running' | 'paused' | 'completed' | 'voided';

/** A closed round in a best-of-N match (snapshot from `matches.rounds_json`). */
export interface RoundSnapshot {
  round: number;
  redScore: number;
  blueScore: number;
  winnerColor: 'red' | 'blue' | null;
  endReason: 'first_to_points' | 'max_doubles' | 'time_limit' | null;
}

export interface MatchRow {
  id: string;
  redScore: number;
  blueScore: number;
  status: MatchStatus;
  startedAt: string | null;
  endedAt: string | null;
  /**
   * Each side's key (`sideKey`): its Fighter's Registration id or its team's id (ADR-022); null
   * while the side is not known, never `''`, so two unknown sides never compare equal.
   */
  redSideId: string | null;
  blueSideId: string | null;
  /** The winner's side key. It outranks the scores: a forfeit can win on the lower one. */
  winnerSideId: string | null;
  // Best-of-N round state (defaults reproduce a single round). bestOf itself is
  // NOT a matches column — it comes from MatchSummary.bestOf below.
  currentRound: number;
  redRoundWins: number;
  blueRoundWins: number;
  awaitingRoundAdvance: boolean;
  roundsJson: RoundSnapshot[] | null;
  /** Why the match ended — 'max_doubles' is the 0–0 double loss. */
  endReason: string | null;
  /** The public may not see this bout, so the page polls it (ruling 92). */
  hiddenFromPublic: boolean;
}

/** Header labels from `/matches/:id/summary` (fighter names, schools, referee, tz). */
export interface MatchSummary {
  roundCode: string;
  redName: string;
  blueName: string;
  redClub: string | null;
  blueClub: string | null;
  eventTimezone: string;
  referees: string[];
  /** Effective best-of for this match's phase (1 = single round). */
  bestOf: number;
  /** The bout's phase: the chart's double cap holds in Pools and Swiss only. */
  phaseType: PhaseType | null;
  /**
   * The tournament's scoring rules. `matchFormat` carries the point cap, the
   * scoring direction and the double cap, so a score can be read correctly
   * rather than assumed; `scoringConfig` carries the OPERATOR'S side colours,
   * so this page paints the tournament's real colours rather than a generic
   * red/blue. Null on an older payload — callers fall back to the defaults.
   */
  matchFormat: MatchFormatConfig | null;
  scoringConfig: TournamentScoringConfig | null;
  /** A team side's colour name (`TOURNAMENT_COLORS`), for its chip; null on a Fighter's side. */
  redColour: string | null;
  blueColour: string | null;
  /** A team side's logo, shown by its name (call 6); null on a Fighter's side. */
  redLogoUrl: string | null;
  blueLogoUrl: string | null;
}

/** Map a raw `matches` row (snake_case, from REST or realtime) to MatchRow. */
export function mapMatchRow(raw: Record<string, unknown>): MatchRow {
  const id = (column: string) => (raw[column] as string | null | undefined) ?? null;
  return {
    id: raw['id'] as string,
    redScore: (raw['red_score'] as number | null) ?? 0,
    blueScore: (raw['blue_score'] as number | null) ?? 0,
    status: (raw['status'] as MatchStatus) ?? 'scheduled',
    startedAt: (raw['started_at'] as string | null) ?? null,
    endedAt: (raw['ended_at'] as string | null) ?? null,
    // A side is a Registration or a team (0282): a team bout leaves the Registration columns null.
    redSideId: sideKey(id('red_registration_id'), id('red_team_id')),
    blueSideId: sideKey(id('blue_registration_id'), id('blue_team_id')),
    winnerSideId: sideKey(id('winner_registration_id'), id('winner_team_id')),
    currentRound: (raw['current_round'] as number | null) ?? 1,
    redRoundWins: (raw['red_round_wins'] as number | null) ?? 0,
    blueRoundWins: (raw['blue_round_wins'] as number | null) ?? 0,
    awaitingRoundAdvance: (raw['awaiting_round_advance'] as boolean | null) ?? false,
    roundsJson: Array.isArray(raw['rounds_json']) ? (raw['rounds_json'] as RoundSnapshot[]) : null,
    endReason: (raw['end_reason'] as string | null) ?? null,
    // Only the bout read (`/matches/:id`) adds this key. A realtime row never
    // carries it, and rightly reads as public: the public channel pushed it.
    hiddenFromPublic: raw['hiddenFromPublic'] === true,
  };
}
