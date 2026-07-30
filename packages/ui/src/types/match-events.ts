/**
 * match-events.ts — the wire shapes for a match's scoring events, shared by
 * every surface that renders them: the referee scoring pad, the TV / external
 * display, and the public match page.
 *
 * Lives in `types/` (a leaf with no imports) rather than beside the hook that
 * fetches them, so `utils/exchange-timeline.ts` can consume these without
 * `utils/` depending on `hooks/` — that inversion would become a real cycle
 * the moment a hook wants `UnifiedEvent` back.
 *
 * These mirror what the API actually returns:
 *   - `GET /matches/:id/exchanges` → the raw `exchanges` row PLUS the camelCase
 *     aliases the timeline reads (`occurredAt`, `clockTimeMs`, `scoringSide`,
 *     `scoreDelta`, `defenderDelta`). Afterblow deltas are already netted
 *     server-side, so clients render them verbatim.
 *   - `GET /matches/:id/penalties` → raw `match_penalties` columns (snake_case).
 *
 * Note the deliberate spelling split: exchange rows carry camelCase
 * `occurredAt` (an API-added alias), penalty rows carry raw `occurred_at`.
 */

export type MatchStatus = 'scheduled' | 'running' | 'paused' | 'completed' | 'voided';

export type ExchangeType = 'clean' | 'afterblow' | 'double' | 'no_exchange';

export type PenaltyCard = 'yellow' | 'red' | 'black';

/** One row of `GET /matches/:id/exchanges`. */
export interface ExchangeRow {
  id: string;
  sequence: number;
  type: ExchangeType;
  voided: boolean;
  /**
   * When the exchange was recorded (client clock, forwarded by the API).
   * REQUIRED: `orderedWithNumbers` sorts on it, so a surface that builds its
   * own rows (e.g. from a realtime payload) must supply it or the newest touch
   * silently sorts to #1. Keeping it non-optional is what makes tsc say so.
   */
  occurredAt: string;
  /** Match-clock position (accumulated active ms) when recorded — drives
   *  the timeline's match-clock time. Null for legacy rows. */
  clockTimeMs?: number | null;
  /** Registration id of the fighter who scored, if applicable. */
  scoringRegistrationId?: string | null;
  /** Side of the scoring fighter — derived BE-side. */
  scoringSide?: 'red' | 'blue' | null;
  /** Numeric score delta for this exchange (positive for the scorer). */
  scoreDelta?: number | null;
  /** Defender delta (only for afterblow_full mode). */
  defenderDelta?: number | null;
  /**
   * Which best-of round this exchange belongs to (1 for a single-round match).
   * Raw column — the API passes it through unaliased with the rest of the row.
   *
   * Load-bearing for anything that must agree with `matches.red_score`, which
   * in a best-of match holds the OPEN round's score only: the server filters on
   * `(round_number ?? 1) === current_round` before scoring, so a client that
   * sums every round disagrees with the numeral on screen.
   */
  round_number?: number | null;
  /** Raw column — the operator's note on a `no_exchange` row. Snake_case
   *  because the API passes the row through without aliasing this one. */
  no_exchange_reason?: string | null;
}

/**
 * One clock transition from `GET /matches/:id/clock` — the `match_events` rows
 * the clock state is folded from, which the endpoint returns alongside the
 * computed state. Start/halt/resume/end/reopen/reset_clock/adjust_time.
 *
 * Replaying them is the only way to know WHERE in match time the clock was
 * stopped: the computed `activeMs` is a total and keeps no history.
 */
export interface ClockEvent {
  type: string;
  occurredAt: string;
  reason?: string | null;
  /** Signed correction applied by an `adjust_time` event. */
  adjustmentMs?: number | null;
}

/** One row of `GET /matches/:id/penalties` (a raw `match_penalties` record). */
export interface Penalty {
  id: string;
  sequence: number;
  registration_id: string;
  card: PenaltyCard;
  source: 'ruleset' | 'direct';
  short_name: string | null;
  reason: string | null;
  score_delta: number;
  causes_match_forfeit: boolean;
  voided: boolean;
  /** ISO timestamp the penalty was applied. */
  occurred_at?: string;
  /** Match-clock position (accumulated active ms) when recorded — drives
   *  the timeline's match-clock time. Null for legacy rows. */
  clock_time_ms?: number | null;
}
