import { z } from 'zod';

export const ForfeitReasonSchema = z.enum([
  'injury',
  'voluntary',
  'black_card_1',
  'black_card_2',
  'conduct_violation',
]);

export type ForfeitReason = z.infer<typeof ForfeitReasonSchema>;

export const ForfeitReasonPolicySchema = z.object({
  scorePolicy: z.enum(['keep_current', 'fixed_loss']),
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
