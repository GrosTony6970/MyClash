import {
  isPoolOrSwissPhase,
  type ForfeitPatch,
  type ForfeitRuleReason,
  type ForfeitRules,
  type ForfeitRulesInForce,
} from '@myclash/types/forfeit-rules';
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

/**
 * The forfeits "disqualify after N forfeits" counts: the ones the Fighter chose. Not an override
 * (nobody forfeited), not a black card (the referee's, ruling 56). The API hands the list to the
 * database's status settle (migration 0240), so the split is typed once.
 */
export const COUNTED_FORFEIT_REASONS = FORFEIT_REASONS.filter(
  (reason) => !isBlackCardReason(reason),
);

/** What a black card does to its Fighter: ends the bout, the whole Tournament, or nothing. */
export const BlackCardEffectSchema = z.enum(['match', 'tournament', 'none']);

export type BlackCardEffect = z.infer<typeof BlackCardEffectSchema>;

/** The opponent's score on a forfeit loss. The loser scores 0. */
const LossScoreSchema = z.number().int().min(1).max(99);

export const ForfeitReasonRuleSchema = z
  .object({
    outcome: z.enum(['keep_current', 'fixed_loss', 'draw']),
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

/** The rules in force: the forfeit rules and what each black card does (ruling 65). */
export const ForfeitRulesInForceSchema = ForfeitRulesSchema.extend({
  firstBlackCard: BlackCardEffectSchema,
  secondBlackCard: BlackCardEffectSchema,
}).strict();

const resettable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();
const reasonRule = ForfeitReasonRuleSchema.shape;
const ReasonRulePatchSchema = z
  .object({
    outcome: resettable(reasonRule.outcome),
    opponentScore: resettable(reasonRule.opponentScore),
    fighter: resettable(reasonRule.fighter),
  })
  .strict();

/**
 * A save of a Tournament's changes (`ForfeitPatch`): strict at every level, each value bounded by
 * `ForfeitRulesSchema`'s own, `null` (a Reset) at a leaf only.
 */
export const ForfeitRulesPatchSchema = z
  .object({
    reasons: z
      .object({
        injury: ReasonRulePatchSchema.optional(),
        voluntary: ReasonRulePatchSchema.optional(),
        conduct_violation: ReasonRulePatchSchema.optional(),
      })
      .strict()
      .optional(),
    disqualifyAfter: resettable(ForfeitRulesSchema.shape.disqualifyAfter),
    disqualifyBeforeFirstBout: resettable(ForfeitRulesSchema.shape.disqualifyBeforeFirstBout),
    blackCardOpponentScore: resettable(ForfeitRulesSchema.shape.blackCardOpponentScore),
    firstBlackCard: resettable(BlackCardEffectSchema),
    secondBlackCard: resettable(BlackCardEffectSchema),
  })
  .strict();

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;

/** The schemas and `@myclash/types/forfeit-rules` describe one shape: a drift stops the compile. */
export type ForfeitRulesSchemaIsTheContract = AssertTrue<
  Exact<z.infer<typeof ForfeitRulesSchema>, ForfeitRules>
>;
export type ForfeitRulesInForceSchemaIsTheContract = AssertTrue<
  Exact<z.infer<typeof ForfeitRulesInForceSchema>, ForfeitRulesInForce>
>;
export type ForfeitRulesPatchSchemaIsTheContract = AssertTrue<
  Exact<z.infer<typeof ForfeitRulesPatchSchema>, ForfeitPatch>
>;

/**
 * How the engine records one forfeit: its score, and what it does to the Fighter. A `'draw'` is
 * 0-0 with no winner (`match_forfeits_draw_has_no_winner`, migration 0239).
 */
export interface ForfeitOutcome {
  scorePolicy: 'keep_current' | 'fixed_loss' | 'draw' | 'explicit';
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
 * - A reason that counts as a draw is one on a Pool or Swiss bout only, of the phase `phaseType`;
 *   a bracket bout has no draw, so there it is the reason's loss (rulings 64, 72).
 */
export function forfeitOutcomeOf(
  rules: ForfeitRules,
  reason: ForfeitReason,
  phaseType: string,
): ForfeitOutcome {
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
  const noDraw = rule.outcome === 'draw' && !isPoolOrSwissPhase(phaseType);
  return {
    scorePolicy: noDraw ? 'fixed_loss' : rule.outcome,
    lossScore: 0,
    opponentScore: rule.opponentScore,
    tournamentState: FIGHTER_STATE[rule.fighter],
  };
}
