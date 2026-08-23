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
  maxDoubleHitOutcome: 'double_loss_zero_scores';
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
export function getEffectiveMaxDoubles(match: Match, config: MatchFormatConfig): number | null {
  return match.phaseType === 'pool' || match.phaseType === 'swiss' ? config.maxDoubleHits : null;
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
  match: Match,
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

  // Max-doubles "double loss" is a pool-only rule (bracket/finals must always
  // resolve to a winner). getEffectiveMaxDoubles returns null off the pool phase.
  const effectiveMaxDoubles = getEffectiveMaxDoubles(match, config);
  if (effectiveMaxDoubles !== null && doubles >= effectiveMaxDoubles) {
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
  endReason: 'first_to_points' | 'max_doubles' | null;
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
    // Pool only: a max-doubles double-loss is a drawn round (no round win).
    return { score, autoOver: true, winnerColor: null, endReason: 'max_doubles' };
  }

  return { score, autoOver: false, winnerColor: null, endReason: null };
}
