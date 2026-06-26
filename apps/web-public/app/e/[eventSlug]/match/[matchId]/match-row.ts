/**
 * Shared, framework-agnostic match data types + the snake_case→camelCase row
 * mapper. Lives OUTSIDE the `'use client'` view module so the server component
 * (page.tsx / generateMetadata) can call `mapMatchRow` directly — calling a
 * function exported from a `'use client'` module on the server throws under RSC.
 *
 * Pure: no React, no I/O.
 */

export type MatchStatus = 'scheduled' | 'running' | 'paused' | 'completed' | 'voided';
export type ExchangeType = 'clean' | 'afterblow' | 'double' | 'no_exchange';

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
}

/** Mirrors the API's `listExchanges` shape (scoringSide/scoreDelta/clockTimeMs). */
export interface ExchangeRow {
  id: string;
  sequence: number;
  type: ExchangeType;
  voided: boolean;
  noExchangeReason: string | null;
  scoringSide: 'red' | 'blue' | null;
  scoreDelta: number | null;
  defenderDelta: number | null;
  clockTimeMs: number | null;
}

export interface MatchPenaltyRow {
  id: string;
  sequence: number;
  registration_id: string;
  card: 'yellow' | 'red' | 'black';
  source: 'ruleset' | 'direct';
  short_name: string | null;
  reason: string | null;
  score_delta: number;
  causes_match_forfeit: boolean;
  voided: boolean;
  occurred_at: string;
  clock_time_ms: number | null;
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
  };
}
