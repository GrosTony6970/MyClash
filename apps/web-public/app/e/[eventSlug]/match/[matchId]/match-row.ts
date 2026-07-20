/**
 * Shared, framework-agnostic match data types + the snake_case→camelCase row
 * mapper. Lives OUTSIDE the `'use client'` view module so the server component
 * (page.tsx / generateMetadata) can call `mapMatchRow` directly — calling a
 * function exported from a `'use client'` module on the server throws under RSC.
 *
 * Pure: no React, no I/O.
 */

import type { ExchangeRow, ExchangeType, Penalty } from '@myclash/ui';

// The exchange + penalty wire shapes are declared once in @myclash/ui
// (packages/ui/src/types/match-events.ts), because the shared timeline builder
// this page renders through needs them too. Re-exported under this module's
// long-standing names so the server page and the client view are unchanged.
// `export type` is required — isolatedModules is on.
export type { ExchangeRow, ExchangeType };
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
  matchNumberLabel: string | null;
  redScore: number;
  blueScore: number;
  status: MatchStatus;
  startedAt: string | null;
  endedAt: string | null;
  winnerRegistrationId: string | null;
  redRegistrationId: string;
  blueRegistrationId: string;
  // Best-of-N round state (defaults reproduce a single round). bestOf itself is
  // NOT a matches column — it comes from MatchSummary.bestOf below.
  currentRound: number;
  redRoundWins: number;
  blueRoundWins: number;
  awaitingRoundAdvance: boolean;
  roundsJson: RoundSnapshot[] | null;
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
}

/** Map a raw `matches` row (snake_case, from REST or realtime) to MatchRow. */
export function mapMatchRow(raw: Record<string, unknown>): MatchRow {
  return {
    id: raw['id'] as string,
    matchNumberLabel: (raw['match_number_label'] as string | null) ?? null,
    redScore: (raw['red_score'] as number | null) ?? 0,
    blueScore: (raw['blue_score'] as number | null) ?? 0,
    status: (raw['status'] as MatchStatus) ?? 'scheduled',
    startedAt: (raw['started_at'] as string | null) ?? null,
    endedAt: (raw['ended_at'] as string | null) ?? null,
    winnerRegistrationId: (raw['winner_registration_id'] as string | null) ?? null,
    redRegistrationId: (raw['red_registration_id'] as string | null) ?? '',
    blueRegistrationId: (raw['blue_registration_id'] as string | null) ?? '',
    currentRound: (raw['current_round'] as number | null) ?? 1,
    redRoundWins: (raw['red_round_wins'] as number | null) ?? 0,
    blueRoundWins: (raw['blue_round_wins'] as number | null) ?? 0,
    awaitingRoundAdvance: (raw['awaiting_round_advance'] as boolean | null) ?? false,
    roundsJson: Array.isArray(raw['rounds_json']) ? (raw['rounds_json'] as RoundSnapshot[]) : null,
  };
}
