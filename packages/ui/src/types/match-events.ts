/**
 * match-events.ts — the wire shapes for a match's scoring events, shared by
 * every surface that renders them: the referee scoring pad, the TV / external
 * display, and the public match page.
 *
 * Lives in `types/` rather than beside the hook that fetches them, so
 * `utils/exchange-timeline.ts` can consume these without `utils/` depending on
 * `hooks/` — that inversion would become a real cycle the moment a hook wants
 * `UnifiedEvent` back.
 *
 * It is a leaf WITHIN packages/ui: the one import below crosses a package
 * boundary to `@myclash/types` and is type-only, so it cannot participate in a
 * cycle here. Keep it that way — an import from `hooks/` or `components/` in
 * this file is the thing the layout exists to prevent.
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
import type { MatchFormatConfig, PhaseType, TournamentScoringConfig } from '@myclash/types';

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
   * The client-generated UUID the server keys idempotency on.
   *
   * `listExchanges` does `select('*')` and spreads the raw row, so this has
   * always been on the wire and the client simply never declared it. It is the
   * dedupe key for a surface that merges its own outbox into this list: between
   * a successful POST and `markSynced` committing, a row is on the server AND
   * still queued locally, and counting it twice is a visible wrong number.
   */
  client_uuid?: string | null;
  /**
   * Queued on the tablet, not yet on the server. Never set by the API — only
   * by the referee pad when it merges its outbox in. See `UnifiedEvent.pending`.
   */
  pending?: boolean;
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
  /**
   * Which rule group this penalty came from. Raw column, already on the wire —
   * `listMatchPenalties` does `select('*')` — and needed to count a fighter's
   * prior offences in the same group, which is what decides whether the next
   * one escalates to a heavier card.
   */
  group_number?: number | null;
  /**
   * Queued on the tablet, not yet on the server. Never set by the API — only
   * by the referee pad when it merges its outbox in. See `UnifiedEvent.pending`.
   */
  pending?: boolean;
}

/**
 * The scoreboard payload, as `GET /matches/:id/display` returns it, and the
 * clock snapshot beside it.
 *
 * Here rather than in `useLiveMatch` because these are WIRE shapes, not hook
 * state — the same reason the exchange and penalty rows already live in this
 * module. `useLiveMatch` re-exports both, so the package's long-standing public
 * surface is unchanged.
 */
export interface DisplayMatch {
  id: string;
  status: MatchStatus;
  /**
   * `phases.type` for this match. Selects which `timeLimitsSeconds` entry the
   * clock counts against — without it a pool bout is billed at the bracket
   * limit, which is what the projector did for every match until now. Optional
   * because a payload predating the projection resolves to the bracket limit,
   * the same default the engine uses for an unknown phase.
   */
  phaseType?: PhaseType | null;
  matchNumberLabel: string | null;
  /** Round code computed server-side: e.g. `LSW-QF-M1`, `RAP-P2-M5`. */
  roundCode?: string | null;
  redScore: number;
  blueScore: number;
  redFighterName: string | null;
  blueFighterName: string | null;
  /** Fighter photos for the scoreboard avatar — resolved server-side from
   *  the global identity (global_persons.photo_url). Null when the fighter
   *  has no photo or isn't linked to a global person. */
  redFighterPhotoUrl?: string | null;
  blueFighterPhotoUrl?: string | null;
  rulesetCode: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Why the match ended: 'first_to_points' | 'time_limit' | 'max_doubles'.
   *  'max_doubles' = double-cap reached → DOUBLE LOSS (both scores 0, no
   *  winner). Null on manual clock-end / forfeit / legacy rows. */
  endReason?: string | null;
  /** Winner's registration id when the ruleset declared one (point cap).
   *  Null for a double loss / tie / not-yet-decided. */
  winnerRegistrationId?: string | null;
  lice?: { name?: string } | null;
  event?: { name?: string } | null;
  tournament?: { name?: string; weapon?: string } | null;
  scoringConfig?: TournamentScoringConfig | null;
  matchFormat?: MatchFormatConfig | null;
  // Best-of-N round state. `bestOf` is the EFFECTIVE number for this match's
  // phase, resolved server-side (1 = single round → the round UI stays hidden).
  bestOf?: number;
  currentRound?: number;
  redRoundWins?: number;
  blueRoundWins?: number;
  awaitingRoundAdvance?: boolean;
  sideOrder?: 'red_left' | 'blue_left';
  poolName?: string | null;
  /** Round token naming this match's phase — `SF`, `R16`, `PI`, `GF`, `LB2`,
   *  `S3` for Swiss. Null for pool matches (which carry poolName instead).
   *  Expand with `roundTokenLabel()` from `@myclash/types`; never render the
   *  raw token at an audience. Drives the TV header context line. */
  roundToken?: string | null;
  fightIndex?: number | null;
  totalFightsInPool?: number | null;
  redClub?: { name: string; logoUrl: string | null } | null;
  blueClub?: { name: string; logoUrl: string | null } | null;
  redRegistrationId?: string | null;
  blueRegistrationId?: string | null;
  /** External-display redesign: next match on this lice (for the
   *  corner NEXT tile + auto-rollover after MATCH ENDED). Public
   *  surfaces can rely on this without a second authenticated
   *  fetch. */
  nextMatchId?: string | null;
  nextMatch?: {
    id: string;
    matchNumberLabel: string | null;
    roundCode: string | null;
    redFighterName: string | null;
    blueFighterName: string | null;
  } | null;
}

export interface ClockSnapshot {
  status: 'idle' | 'running' | 'halted' | 'ended';
  activeMs: number;
  runningFrom: string | null;
  /**
   * The transitions `activeMs` was folded from. The endpoint has always
   * returned these; this type simply dropped them. The bout-flow chart replays
   * them to position its stoppage markers — `activeMs` alone cannot say WHERE
   * the clock stopped, only how much ran in total.
   */
  events?: ClockEvent[];
}
