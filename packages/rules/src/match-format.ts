/**
 * Match format — the arithmetic of a bout, with no schema anywhere near it.
 *
 * ── The split this file is half of ──────────────────────────────────────────
 * `@myclash/rulesets/src/match-format.ts` used to hold both the zod schemas that
 * VALIDATE a match-format config and the arithmetic that APPLIES one. Only the
 * first half needs zod. The second half — every function below — touches it
 * zero times, and being in the same file was the whole reason the scoring pad
 * could not reach it.
 *
 * The schemas stayed. `MatchFormatConfigSchema` still parses, still defaults,
 * still owns the federal baseline; a compile-time assertion there proves what it
 * produces satisfies the interface declared here. Zod is inverted OUT of the
 * contract: this package describes the shape, that package validates into it.
 *
 * ── MatchFormatConfig had two owners ────────────────────────────────────────
 * `@myclash/rulesets` derived it from the schema with `z.infer`, and
 * `@myclash/types` hand-wrote a structurally identical interface. Nothing
 * checked that they agreed, and every consumer picked whichever one its package
 * could already import. That is the same accident as the afterblow netting, one
 * type later.
 */
import { computeAfterblowDeltas, type AfterblowMode } from './afterblow';
import type { Exchange, Match, MatchScore, PhaseType } from './domain';

export type ScoringDirection = 'normal' | 'reverse_zero_loses';
export type TimerMode = 'countdown' | 'countup';

/**
 * What happens to a bout that reaches the doubles ceiling. The ceiling itself
 * ends the bout either way; this says what the result IS.
 *
 *   double_loss_zero_scores  both scores wiped, and it counts as a loss for
 *                            each fighter — the federal reading, and the default
 *   draw_zero_scores         both scores wiped, and it counts as a draw
 *   result_stands            the bout simply stops: the scores on the board
 *                            stand and whoever leads wins it
 *
 * The chosen value is resolved into `matches.end_reason` at completion rather
 * than read back by every consumer. That matters because the readers include a
 * SQL function and cross-event fighter stats, neither of which has the
 * tournament's config in hand — see `maxDoubleHitEndReason`.
 */
export type MaxDoubleHitOutcome = 'double_loss_zero_scores' | 'draw_zero_scores' | 'result_stands';

/**
 * The `matches.end_reason` values a ceiling-ended bout can carry — one per
 * {@link MaxDoubleHitOutcome}. Only `'max_doubles'` means loss for both.
 */
export type MaxDoubleHitEndReason =
  'max_doubles' | 'max_doubles_draw' | 'max_doubles_result_stands';

/**
 * A resolved match format. Plain data — this is what a ruleset RESOLVES TO, and
 * what the pad already carries in `tournaments.scoring_config_json`.
 */
export interface MatchFormatConfig {
  pointCap: number;
  scoringDirection: ScoringDirection;
  timerMode: TimerMode;
  timeLimitsSeconds: {
    pool: number | null;
    /**
     * Optional on purpose: every ruleset config persisted before the Swiss
     * format exists without this key, and `getEffectiveMatchTimeLimitSeconds`
     * falls back to `pool` when it is absent. Giving it a default would rewrite
     * those stored configs on the next round-trip.
     */
    swiss?: number | null;
    bracket: number | null;
    finals: number | null;
  };
  softClockLimitSeconds: number;
  maxDoubleHits: number | null;
  maxDoubleHitOutcome: MaxDoubleHitOutcome;
  /**
   * Best-of-N rounds per phase. A match is decided by winning ceil(N/2) rounds.
   * 1 = single round (default everywhere). Odd values only. Mirrors
   * {@link timeLimitsSeconds} so each phase configures independently.
   */
  bestOf: {
    pool: number;
    /** Optional, falling back to `pool` — same reasoning as `timeLimitsSeconds.swiss`. */
    swiss?: number;
    bracket: number;
    finals: number;
  };
}

/**
 * Medal matches are identified by their label, not their bracket round: a
 * bronze match sits in the same round as nothing else, and the finals time
 * limit is configured separately from the rest of the bracket.
 */
export function isMedalMatchLabel(label: string | null | undefined): boolean {
  const normalized = (label ?? '').trim().toUpperCase();
  return (
    normalized === 'F' ||
    normalized === 'FINAL' ||
    normalized === 'GOLD' ||
    normalized === 'GOLD MEDAL MATCH' ||
    normalized === '3RD' ||
    normalized === 'BRONZE' ||
    normalized === 'BRONZE MEDAL MATCH'
  );
}

/**
 * The time limit this match counts against, in seconds. `null` = no limit
 * (the clock can only count up).
 *
 * Takes the phase and the label rather than a {@link Match}, because every
 * scoreboard has those two and none of them has a whole match: the projector
 * renders a row, the pad renders its own fetched summary. The Match-shaped
 * entry point is {@link getEffectiveMatchTimeLimitSeconds}.
 */
export function effectiveTimeLimitSeconds(
  config: MatchFormatConfig,
  phaseType: PhaseType | undefined,
  matchNumberLabel: string | null | undefined,
): number | null {
  if (phaseType === 'pool') return config.timeLimitsSeconds.pool;
  // `?? pool` and not `?? bracket`: a Swiss round is a group stage, and a
  // config written before Swiss existed carries no swiss key at all.
  if (phaseType === 'swiss') {
    return config.timeLimitsSeconds.swiss ?? config.timeLimitsSeconds.pool;
  }
  if (isMedalMatchLabel(matchNumberLabel)) return config.timeLimitsSeconds.finals;
  return config.timeLimitsSeconds.bracket;
}

export function getEffectiveMatchTimeLimitSeconds(
  match: Match,
  config: MatchFormatConfig,
): number | null {
  return effectiveTimeLimitSeconds(config, match.phaseType, match.matchNumberLabel);
}

/**
 * Effective best-of for this match by phase, mirroring the time-limit dispatch:
 * pool → bestOf.pool, swiss → bestOf.swiss ?? bestOf.pool, medal match →
 * bestOf.finals, else (bracket) → bestOf.bracket.
 * Returns 1 (single round) when bestOf is absent (legacy configs).
 */
export function getEffectiveBestOf(match: Match, config: MatchFormatConfig): number {
  const bestOf = config.bestOf ?? { pool: 1, bracket: 1, finals: 1 };
  if (match.phaseType === 'pool') return bestOf.pool;
  if (match.phaseType === 'swiss') return bestOf.swiss ?? bestOf.pool;
  if (isMedalMatchLabel(match.matchNumberLabel)) return bestOf.finals;
  return bestOf.bracket;
}

/** Round wins needed to take a best-of-N match: ⌈N/2⌉ (1 for a single round). */
export function roundWinTarget(bestOf: number): number {
  return Math.ceil(Math.max(1, bestOf) / 2);
}

/**
 * Effective max-doubles end condition by phase. The max-doubles "double loss"
 * rule applies in the group stages — pools and Swiss rounds — where a
 * double loss (0 points each) is a coherent result the standings can carry.
 * Bracket & finals must always produce a winner, so they never end on
 * max-doubles (single-round or best-of). A match without a known phase is
 * treated as non-group (no max-doubles), matching the time-limit dispatch's
 * default.
 */
/**
 * `match` is narrowed to the one field this reads. Callers that hold a finished
 * bout rather than a whole Match — the pool-scoring path holds a `ScoredMatch`
 * — can then ask directly instead of casting a row into a shape it is not.
 */
export function getEffectiveMaxDoubles(
  match: Pick<Match, 'phaseType'>,
  config: MatchFormatConfig,
): number | null {
  return match.phaseType === 'pool' || match.phaseType === 'swiss' ? config.maxDoubleHits : null;
}

/**
 * Which side is ahead on the board, or null when level.
 *
 * Distinct from {@link pointCapWinnerColor}, which answers "who reached the
 * cap". Under `result_stands` the bout ends on the CEILING, so nobody reached
 * the cap and the winner is simply whoever leads.
 */
export function leadingColor(
  score: Pick<MatchScore, 'redScore' | 'blueScore'>,
): 'red' | 'blue' | null {
  if (score.redScore > score.blueScore) return 'red';
  if (score.blueScore > score.redScore) return 'blue';
  return null;
}

/**
 * Did this bout end as a LOSS FOR BOTH fighters?
 *
 * The one owner of the fact that `'max_doubles'` — and only that reason — means
 * a double loss. It reads a raw `matches.end_reason`, because that is what every
 * caller has: a completed bout, no config in hand.
 *
 * Here rather than inferred from the scores because it CANNOT be: a double loss
 * is 0-0 with no winner, which is indistinguishable from a draw. Every consumer
 * that tried to read the outcome off the score or the winner therefore got it
 * wrong, each in its own way — a draw in the standings, a draw on a fighter's
 * recent form, and a VICTORY for the leader in the formula rulesets.
 *
 * The other two ceiling reasons deliberately return false: `'max_doubles_draw'`
 * IS a draw and `'max_doubles_result_stands'` carries a real winner, so both are
 * already read correctly by every consumer.
 *
 * The SQL side (`compact_fighter_stats`) repeats the literal, because it cannot
 * import this. That copy is named in the migration that carries it.
 */
export function isDoubleLossBout(endReason: string | null | undefined): boolean {
  return endReason === 'max_doubles';
}

/**
 * Which side won, from the bout's own columns. The ladder, and nothing else.
 *
 * A recorded `winner_registration_id` decides, never the scores: a forfeit, a
 * walkover or a referee override can award a bout to the fighter BEHIND on
 * points, which is the canonical reason explicit scores exist at all.
 *
 * The score fallback below it is deliberate. A completed bout with no stored
 * winner is ordinary rather than exotic — it is every genuine draw, and it was
 * every time-limit bout until the clock started naming its own winner.
 *
 * A stored winner matching NEITHER side means the caller handed over a
 * mismatched pairing, and answering "nobody" is honest where falling through to
 * the scores would invent someone.
 *
 * Extracted from `resolveMatchWinner`, which keeps the status guard and its
 * eight display call sites and now delegates the rule here — so the crown on a
 * scoreboard and the W in a standings table cannot drift apart.
 */
export function winnerColorFrom(bout: {
  winnerRegistrationId?: string | null;
  redRegistrationId?: string | null;
  blueRegistrationId?: string | null;
  redScore?: number | null;
  blueScore?: number | null;
}): 'red' | 'blue' | null {
  const winner = bout.winnerRegistrationId ?? null;
  if (winner !== null) {
    if (winner === bout.redRegistrationId) return 'red';
    if (winner === bout.blueRegistrationId) return 'blue';
    return null;
  }
  return leadingColor({ redScore: bout.redScore ?? 0, blueScore: bout.blueScore ?? 0 });
}

/** What one bout was worth to one fighter. */
export type BoutOutcome = 'win' | 'loss' | 'draw';

/**
 * What a finished bout was worth to BOTH fighters.
 *
 * Returns the pair rather than one side's answer, because a double loss is the
 * one outcome a single-sided view cannot express — and that is precisely how it
 * kept getting lost. Five sites derived this rule for themselves and gave a
 * 3-1 time-out five different answers, on the same fighter's profile.
 *
 * `endReason` is REQUIRED, not optional. The last version of this rule took it
 * as an optional trailing parameter and one caller kept passing four arguments,
 * so a max-doubles bout quietly read as a draw on the public person-schedule
 * page. An optional input is a silent opt-out; a caller with nothing to say here
 * has to say `null` out loud.
 */
export function boutOutcomes(bout: {
  winnerRegistrationId?: string | null;
  redRegistrationId?: string | null;
  blueRegistrationId?: string | null;
  redScore?: number | null;
  blueScore?: number | null;
  endReason: string | null;
}): { red: BoutOutcome; blue: BoutOutcome } {
  // First: a ceiling double loss is 0-0 with no winner, so both tests below it
  // read it as a draw.
  if (isDoubleLossBout(bout.endReason)) return { red: 'loss', blue: 'loss' };
  const winner = winnerColorFrom(bout);
  if (winner === 'red') return { red: 'win', blue: 'loss' };
  if (winner === 'blue') return { red: 'loss', blue: 'win' };
  return { red: 'draw', blue: 'draw' };
}

/** Does reaching the ceiling wipe the board? Two of the three outcomes do. */
export function maxDoubleHitZeroesScores(config: MatchFormatConfig): boolean {
  return config.maxDoubleHitOutcome !== 'result_stands';
}

/**
 * The `matches.end_reason` a ceiling-ended bout is recorded under.
 *
 * THE OUTCOME IS RESOLVED HERE, ONCE, AND TRAVELS AS THE REASON. Every reader
 * of a finished bout would otherwise need the tournament's match format to
 * interpret a single `'max_doubles'` marker — and the readers include a SQL
 * function (`compact_fighter_stats`), cross-event fighter stats and the archive
 * CSVs, none of which has that config in hand.
 *
 * Only `'max_doubles'` means LOSS FOR BOTH, which is what it has always meant,
 * so Swiss standings, the HEMA Ratings export and the TV scoreboard keep working
 * untouched. The other two values need no special case anywhere: a
 * `'max_doubles_draw'` bout is 0-0 with no winner, which already reads as a
 * draw, and a `'max_doubles_result_stands'` bout carries a real winner, which
 * every winner-based reader already handles.
 */
export function maxDoubleHitEndReason(config: MatchFormatConfig): MaxDoubleHitEndReason {
  switch (config.maxDoubleHitOutcome) {
    case 'draw_zero_scores':
      return 'max_doubles_draw';
    case 'result_stands':
      return 'max_doubles_result_stands';
    default:
      return 'max_doubles';
  }
}

/**
 * Which side reached the point cap, as a colour (mirrors
 * {@link getPointCapWinnerRegistrationId} without needing the registration ids).
 */
export function pointCapWinnerColor(
  score: Pick<MatchScore, 'redScore' | 'blueScore'>,
  config: MatchFormatConfig,
): 'red' | 'blue' | null {
  if (config.scoringDirection === 'reverse_zero_loses') {
    if (score.redScore <= 0 && score.blueScore <= 0) return null;
    if (score.redScore <= 0) return 'blue';
    if (score.blueScore <= 0) return 'red';
    return null;
  }
  if (score.redScore >= config.pointCap && score.blueScore >= config.pointCap) return null;
  if (score.redScore >= config.pointCap) return 'red';
  if (score.blueScore >= config.pointCap) return 'blue';
  return null;
}

/**
 * Raw elapsed active ms → the numeral to put on the scoreboard. Countdown
 * subtracts from the phase limit and clamps at zero; count-up (or a phase with
 * no limit) returns elapsed unchanged.
 *
 * This is the number a referee reads AND the number the bout ends on. It had
 * two implementations — one here and one in `@myclash/types` (match-clock.ts) —
 * kept in step by a parity test in the API, the one place that could see both
 * packages at once. Drift did not throw: it showed a referee 01:30 while the
 * engine counted to 02:00.
 */
export function displayClockMs(
  elapsedMs: number,
  config: MatchFormatConfig,
  phaseType: PhaseType | undefined,
  matchNumberLabel: string | null | undefined,
): number {
  if (config.timerMode === 'countup') return Math.max(0, elapsedMs);

  const limitSeconds = effectiveTimeLimitSeconds(config, phaseType, matchNumberLabel);
  if (limitSeconds === null) return Math.max(0, elapsedMs);
  return Math.max(0, limitSeconds * 1000 - elapsedMs);
}

export function isSoftClockLocked(
  match: Match,
  elapsedMs: number,
  clockRunning: boolean,
  config: MatchFormatConfig,
): boolean {
  if (clockRunning || config.timerMode !== 'countdown' || config.softClockLimitSeconds <= 0) {
    return false;
  }

  const limitSeconds = getEffectiveMatchTimeLimitSeconds(match, config);
  if (limitSeconds === null) return false;
  const remainingMs = Math.max(0, limitSeconds * 1000 - elapsedMs);
  return remainingMs < config.softClockLimitSeconds * 1000;
}

/**
 * Points EARNED → the scores a scoreboard shows, under the config's direction.
 *
 * In `reverse_zero_loses` a fighter starts at the point cap and their opponent
 * takes it off them, so a side's score is what the OTHER side earned. That one
 * rule is the whole transform, and it had a second hand-written copy in
 * `packages/ui/src/utils/bout-flow.ts` — whose own docblock said it reproduces
 * the engine's transform rather than the raw deltas, which is exactly the
 * accident this package exists to stop.
 *
 * Penalties are deliberately NOT applied here. They land AFTER the direction
 * transform (the order `recomputeMatchScore` uses), so a caller adds them to
 * the result rather than to the earnings.
 */
export function applyScoringDirection(
  config: Pick<MatchFormatConfig, 'pointCap' | 'scoringDirection'>,
  redEarned: number,
  blueEarned: number,
): { redScore: number; blueScore: number } {
  if (config.scoringDirection !== 'reverse_zero_loses') {
    return { redScore: redEarned, blueScore: blueEarned };
  }
  return {
    redScore: Math.max(0, config.pointCap - blueEarned),
    blueScore: Math.max(0, config.pointCap - redEarned),
  };
}

export function computeMatchFormatScore(
  match: Pick<Match, 'phaseType'>,
  exchanges: Exchange[],
  config: MatchFormatConfig,
  afterblowMode: AfterblowMode = 'full',
): MatchScore {
  const active = exchanges.filter((e) => !e.voided);

  let redEarned = 0;
  let blueEarned = 0;
  let redTargetPoints = 0;
  let blueTargetPoints = 0;
  let redTimesHit = 0;
  let blueTimesHit = 0;
  let doubles = 0;

  for (const ex of active) {
    switch (ex.type) {
      case 'clean':
        if (ex.firstStrikerColor === 'red') {
          redEarned += ex.firstStrikeValue ?? 0;
          redTargetPoints += ex.firstStrikeValue ?? 0;
          blueTimesHit += 1;
        } else if (ex.firstStrikerColor === 'blue') {
          blueEarned += ex.firstStrikeValue ?? 0;
          blueTargetPoints += ex.firstStrikeValue ?? 0;
          redTimesHit += 1;
        }
        break;

      case 'afterblow': {
        // Raw button values are stored on the exchange; the mode decides how
        // they net. In 'deductive' the defender's afterblow is subtracted from
        // the attacker (defender scores 0); in 'full' both keep their points.
        const { attackerDelta, defenderDelta } = computeAfterblowDeltas(
          afterblowMode,
          ex.firstStrikeValue ?? 0,
          ex.afterblowValue ?? 0,
        );
        if (ex.firstStrikerColor === 'red') {
          redEarned += attackerDelta;
          redTargetPoints += attackerDelta;
          blueEarned += defenderDelta;
          blueTargetPoints += defenderDelta;
          redTimesHit += 1;
        } else if (ex.firstStrikerColor === 'blue') {
          blueEarned += attackerDelta;
          blueTargetPoints += attackerDelta;
          redEarned += defenderDelta;
          redTargetPoints += defenderDelta;
          blueTimesHit += 1;
        }
        break;
      }

      case 'double':
        doubles += 1;
        break;

      case 'no_exchange':
        break;
    }
  }

  // Max-doubles is a pool-only rule (bracket/finals must always resolve to a
  // winner). getEffectiveMaxDoubles returns null off the pool phase.
  //
  // Whether reaching it WIPES the scores is the organiser's choice: under
  // `result_stands` the bout stops but the board stands, so there is nothing to
  // zero and the fighter who leads wins it.
  const effectiveMaxDoubles = getEffectiveMaxDoubles(match, config);
  if (
    effectiveMaxDoubles !== null &&
    doubles >= effectiveMaxDoubles &&
    maxDoubleHitZeroesScores(config)
  ) {
    return {
      redScore: 0,
      blueScore: 0,
      redWins: 0,
      blueWins: 0,
      redTargetPoints,
      blueTargetPoints,
      redTimesHit,
      blueTimesHit,
      doubles,
    };
  }

  const { redScore, blueScore } = applyScoringDirection(config, redEarned, blueEarned);

  return {
    redScore,
    blueScore,
    redWins: 0,
    blueWins: 0,
    redTargetPoints,
    blueTargetPoints,
    redTimesHit,
    blueTimesHit,
    doubles,
  };
}

export function isPointCapReached(score: MatchScore, config: MatchFormatConfig): boolean {
  if (config.scoringDirection === 'reverse_zero_loses') {
    return score.redScore <= 0 || score.blueScore <= 0;
  }
  return score.redScore >= config.pointCap || score.blueScore >= config.pointCap;
}

export function getPointCapWinnerRegistrationId(
  match: Match,
  score: Pick<MatchScore, 'redScore' | 'blueScore'>,
  config: MatchFormatConfig,
): string | null {
  if (config.scoringDirection === 'reverse_zero_loses') {
    if (score.redScore <= 0 && score.blueScore <= 0) return null;
    if (score.redScore <= 0) return match.blueRegistrationId;
    if (score.blueScore <= 0) return match.redRegistrationId;
    return null;
  }

  if (score.redScore >= config.pointCap && score.blueScore >= config.pointCap) return null;
  if (score.redScore >= config.pointCap) return match.redRegistrationId;
  if (score.blueScore >= config.pointCap) return match.blueRegistrationId;
  return null;
}

/** A round's automatic end condition, evaluated from that round's exchanges. */
export interface RoundEvaluation {
  /** Live score of this round (current open round, or the round being closed). */
  score: MatchScore;
  /**
   * True when the round ended on an AUTOMATIC condition (point cap, or pool
   * max-doubles). Time-expiry is NOT automatic — it's operator-driven (the
   * engine never sees the clock here), so `autoOver` is false when only time
   * would end the round; the operator closes it via the End-round action.
   */
  autoOver: boolean;
  /** Round winner when `autoOver`; null for a drawn round (pool max-doubles). */
  winnerColor: 'red' | 'blue' | null;
  endReason: 'first_to_points' | MaxDoubleHitEndReason | null;
}

/**
 * How a round's exchanges become a score.
 *
 * A parameter and not a fixed call, because the API runs the RESOLVED ruleset's
 * own `computeMatchScore` here: a custom ruleset must score a round of a
 * best-of match exactly the way it scores a single-round match. The default
 * covers every caller that has no resolved ruleset to hand.
 */
export type RoundScorer = (match: Match, roundExchanges: Exchange[]) => MatchScore;

/**
 * Evaluate a single round from its (round-scoped) exchanges. Used by the
 * best-of round lifecycle: the open round is scored live and auto-closes on
 * point cap or pool max-doubles.
 *
 * The API had its own copy of the three checks below, as
 * `ScoringService.evaluateOpenRound`, for one reason: it needed the resolved
 * ruleset's scorer and this function hard-coded {@link computeMatchFormatScore}.
 * `scoreRound` is that reason removed.
 */
export function evaluateRound(
  match: Match,
  roundExchanges: Exchange[],
  config: MatchFormatConfig,
  scoreRound: RoundScorer = (m, exchanges) => computeMatchFormatScore(m, exchanges, config),
): RoundEvaluation {
  const score = scoreRound(match, roundExchanges);

  if (isPointCapReached(score, config)) {
    return {
      score,
      autoOver: true,
      winnerColor: pointCapWinnerColor(score, config),
      endReason: 'first_to_points',
    };
  }

  const effectiveMaxDoubles = getEffectiveMaxDoubles(match, config);
  if (effectiveMaxDoubles !== null && score.doubles >= effectiveMaxDoubles) {
    // Pool only. A wiped board is a drawn round (no round win for either side);
    // under `result_stands` the board still holds a leader, so the round is won.
    return {
      score,
      autoOver: true,
      winnerColor: maxDoubleHitZeroesScores(config) ? null : leadingColor(score),
      endReason: maxDoubleHitEndReason(config),
    };
  }

  return { score, autoOver: false, winnerColor: null, endReason: null };
}
