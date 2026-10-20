import type { ForfeitRuleReason, ForfeitRules } from '@myclash/types/forfeit-rules';
import { z } from 'zod';

/**
 * A fighter stopped fighting — the result follows from that.
 *
 * These are the reasons HEMA Ratings means when it excludes "walk-overs or
 * forfeits", and the ones the standings F column counts.
 */
export const FORFEIT_REASONS = [
  'injury',
  'voluntary',
  'black_card_1',
  'black_card_2',
  'conduct_violation',
] as const;

/**
 * The recorded result is wrong and an organiser is correcting it.
 *
 * Nobody forfeited. These reasons share `match_forfeits` — one writer, one void
 * path, one table for standings, exports, HEMA Ratings and archive coverage to
 * know about — but they are NOT forfeits, and every read that counts forfeits
 * must filter to `FORFEIT_REASONS`. The accepted cost of that decision is that
 * "forfeit" is now a slightly wrong name for what the table holds.
 */
export const OVERRIDE_REASONS = [
  'referee_decision',
  'admin_correction',
  'technical_failure',
] as const;

export const ForfeitReasonSchema = z.enum([...FORFEIT_REASONS, ...OVERRIDE_REASONS]);

export type ForfeitReason = z.infer<typeof ForfeitReasonSchema>;

/**
 * True when this reason records a correction rather than a forfeit.
 *
 * The single owner of that distinction. Filtering a query by
 * `FORFEIT_REASONS`/`OVERRIDE_REASONS` and testing a value with this function
 * are the same question asked in two places; do not re-derive it from a
 * hand-written list at a call site.
 */
export function isOverrideReason(reason: string): boolean {
  return (OVERRIDE_REASONS as readonly string[]).includes(reason);
}

/**
 * A black card ended the bout. What it does to the Fighter is the card rule's of the penalty
 * ruleset, and it counts toward no "disqualify after N forfeits" (rulings 54 and 56): the referee
 * gave it, the Fighter did not choose it.
 */
export const BLACK_CARD_REASONS = ['black_card_1', 'black_card_2'] as const;

export type BlackCardReason = (typeof BLACK_CARD_REASONS)[number];

export function isBlackCardReason(reason: string): reason is BlackCardReason {
  return (BLACK_CARD_REASONS as readonly string[]).includes(reason);
}

/** What a black card does to its Fighter: ends the bout, the whole Tournament, or nothing. */
export const BlackCardEffectSchema = z.enum(['match', 'tournament', 'none']);

export type BlackCardEffect = z.infer<typeof BlackCardEffectSchema>;

/** The opponent's score on a forfeit loss. The loser scores 0. */
const LossScoreSchema = z.number().int().min(1).max(99);

export const ForfeitReasonRuleSchema = z
  .object({
    outcome: z.enum(['keep_current', 'fixed_loss']),
    opponentScore: LossScoreSchema,
    fighter: z.enum(['continues', 'asks', 'withdrawn', 'disqualified']),
  })
  .strict();

/**
 * What a forfeit does, as a penalty ruleset stores it (`penalty_rulesets.forfeit_rules`, rulings
 * 63-76). Strict at every level: a stored value is either the whole shape or refused.
 */
export const ForfeitRulesSchema = z
  .object({
    reasons: z
      .object({
        injury: ForfeitReasonRuleSchema,
        voluntary: ForfeitReasonRuleSchema,
        conduct_violation: ForfeitReasonRuleSchema,
      })
      .strict(),
    disqualifyAfter: z.union([z.number().int().min(1).max(10), z.literal('off')]),
    disqualifyBeforeFirstBout: z.boolean(),
    blackCardOpponentScore: LossScoreSchema,
  })
  .strict();

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;

/** The schema and `@myclash/types/forfeit-rules` describe one shape: a drift stops the compile. */
export type ForfeitRulesSchemaIsTheContract = AssertTrue<
  Exact<z.infer<typeof ForfeitRulesSchema>, ForfeitRules>
>;

/** How the engine records one forfeit: its score, and what it does to the Fighter. */
export interface ForfeitOutcome {
  scorePolicy: 'keep_current' | 'fixed_loss' | 'explicit';
  /** The forfeiting Fighter's score on a loss. */
  lossScore: number;
  opponentScore: number;
  tournamentState: 'ask' | 'match_only' | 'withdrawn' | 'disqualified';
}

/** An override's: it reads no forfeit rule, so a caller with none to read uses this. */
export const OVERRIDE_OUTCOME: ForfeitOutcome = {
  scorePolicy: 'explicit',
  lossScore: 0,
  opponentScore: 0,
  tournamentState: 'match_only',
};

const FIGHTER_STATE = {
  continues: 'match_only',
  asks: 'ask',
  withdrawn: 'withdrawn',
  disqualified: 'disqualified',
} as const;

/**
 * The forfeit of `reason` under `rules`.
 *
 * - An override states the result and nothing else: its scores are the caller's, and
 *   `match_only` makes the Fighter continue with no status written, so correcting a result can
 *   never withdraw or disqualify anyone.
 * - A black card is a loss of 0 to `blackCardOpponentScore` (ruling 69). What it does to the
 *   Fighter is its card rule's, which the caller lays over this `tournamentState`.
 */
export function forfeitOutcomeOf(rules: ForfeitRules, reason: ForfeitReason): ForfeitOutcome {
  if (isOverrideReason(reason)) return OVERRIDE_OUTCOME;
  if (isBlackCardReason(reason)) {
    const opponentScore = rules.blackCardOpponentScore;
    return {
      scorePolicy: 'fixed_loss',
      lossScore: 0,
      opponentScore,
      tournamentState: 'match_only',
    };
  }
  const rule = rules.reasons[reason as ForfeitRuleReason];
  return {
    scorePolicy: rule.outcome,
    lossScore: 0,
    opponentScore: rule.opponentScore,
    tournamentState: FIGHTER_STATE[rule.fighter],
  };
}
