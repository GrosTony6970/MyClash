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

export const ForfeitReasonPolicySchema = z.object({
  // 'explicit' takes the two scores from the caller instead of the config —
  // the only policy an override can use, since a correction states the real
  // result rather than deriving one.
  scorePolicy: z.enum(['keep_current', 'fixed_loss', 'explicit']),
  lossScore: z.number().int().min(0).default(0),
  opponentScore: z.number().int().min(0).default(6),
  tournamentState: z.enum(['ask', 'match_only', 'withdrawn', 'disqualified']),
});

export type ForfeitReasonPolicy = z.infer<typeof ForfeitReasonPolicySchema>;

export const ForfeitPolicySchema = z.object({
  reasons: z.record(ForfeitReasonSchema, ForfeitReasonPolicySchema),
});

export type ForfeitPolicy = z.infer<typeof ForfeitPolicySchema>;

export const DEFAULT_FORFEIT_POLICY: ForfeitPolicy = {
  reasons: {
    injury: {
      scorePolicy: 'keep_current',
      lossScore: 0,
      opponentScore: 6,
      tournamentState: 'ask',
    },
    voluntary: {
      scorePolicy: 'fixed_loss',
      lossScore: 0,
      opponentScore: 6,
      tournamentState: 'ask',
    },
    black_card_1: {
      scorePolicy: 'fixed_loss',
      lossScore: 0,
      opponentScore: 6,
      tournamentState: 'ask',
    },
    black_card_2: {
      scorePolicy: 'fixed_loss',
      lossScore: 0,
      opponentScore: 6,
      tournamentState: 'disqualified',
    },
    conduct_violation: {
      scorePolicy: 'fixed_loss',
      lossScore: 0,
      opponentScore: 6,
      tournamentState: 'disqualified',
    },
    // The three overrides below all read the same way ON PURPOSE: an override
    // states the result and nothing else. `match_only` is load-bearing —
    // it makes resolveCanContinue return true and applyTournamentState a
    // no-op, so correcting a result can never withdraw or disqualify anyone.
    referee_decision: {
      scorePolicy: 'explicit',
      lossScore: 0,
      opponentScore: 0,
      tournamentState: 'match_only',
    },
    admin_correction: {
      scorePolicy: 'explicit',
      lossScore: 0,
      opponentScore: 0,
      tournamentState: 'match_only',
    },
    technical_failure: {
      scorePolicy: 'explicit',
      lossScore: 0,
      opponentScore: 0,
      tournamentState: 'match_only',
    },
  },
};

export function normalizeForfeitPolicy(config: unknown): ForfeitPolicy {
  const input = (config as { forfeitPolicy?: unknown; reasons?: unknown } | null) ?? {};
  const rawPolicy = input.forfeitPolicy ?? (input.reasons ? input : {});
  const partial = rawPolicy as Partial<ForfeitPolicy>;
  return ForfeitPolicySchema.parse({
    reasons: {
      ...DEFAULT_FORFEIT_POLICY.reasons,
      ...(partial.reasons ?? {}),
    },
  });
}

export function resolveForfeitPolicy(config: unknown, reason: ForfeitReason): ForfeitReasonPolicy {
  return normalizeForfeitPolicy(config).reasons[reason];
}
