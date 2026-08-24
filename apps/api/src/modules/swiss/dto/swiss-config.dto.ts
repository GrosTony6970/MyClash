import { z } from 'zod';

/**
 * The Swiss phase's `phases.config_json`.
 *
 * Everything the pairing and the standings need, validated on the way in so a
 * malformed blob cannot reach the engine — a Swiss phase is re-read every round
 * for the whole event, so a bad config is not a one-off failure.
 */

/**
 * Tiebreak keys an organiser may put in the chain — a CLOSED whitelist.
 *
 * `applyRanking` reads `Number(row.stats[key] ?? 0)` and is generic over
 * unknown keys, which is what makes a configurable chain cheap. It is also what
 * makes an open list dangerous: a typo'd key would silently rank every fighter
 * on 0 rather than erroring, and the standings would look plausible.
 */
/**
 * The tiebreak vocabulary, from `@myclash/rules`. It lives there because
 * `swiss-tiebreaks.ts` -- which turns a configured chain into RankingRule[] --
 * is moving into the deterministic core, and the core cannot import this DTO.
 * web-admin's picker reads the same list rather than mirroring it.
 */
export { SWISS_TIEBREAK_KEYS } from '@myclash/rules';
export type { SwissTiebreakKey } from '@myclash/rules';
import { SWISS_TIEBREAK_KEYS } from '@myclash/rules';
import type { SwissTiebreakKey } from '@myclash/rules';

export const SWISS_SEEDING_STRATEGIES = ['random', 'by-rating', 'by-pool-rank'] as const;
export const SWISS_PAIRING_METHODS = ['fold', 'adjacent'] as const;

/** Buchholz first, then Sonneborn-Berger, then defer to the ruleset. */
export const DEFAULT_SWISS_TIEBREAK_CHAIN: SwissTiebreakKey[] = [
  'buchholz',
  'sonnebornBerger',
  'rulesetChain',
];

export const DEFAULT_SWISS_POINTS = { win: 3, draw: 1, loss: 0, bye: 3 } as const;

/**
 * Score bands: the boundaries between them, ascending.
 *
 * Bounded at 10 because bands only exist to create GROUPS out of a continuous
 * score — past a handful of boundaries every band holds one fighter and the
 * pairing degenerates to exactly what bands were introduced to avoid.
 */
const scoreBandBoundaries = z
  .array(z.number())
  .min(1)
  .max(10)
  .refine((values) => values.every((v, i) => i === 0 || v > values[i - 1]!), {
    message: 'Score band boundaries must be strictly ascending and unique',
  });

export const swissGroupingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('points') }).strict(),
  z.object({ kind: z.literal('scoreBands'), boundaries: scoreBandBoundaries }).strict(),
]);

export const swissPointsSchema = z
  .object({
    win: z.number(),
    draw: z.number(),
    loss: z.number(),
    /**
     * What a bye is worth. Defaults to a win: sitting out is not the fighter's
     * doing, and scoring it lower would penalise them for the field being odd.
     */
    bye: z.number(),
  })
  .strict();

export const swissConfigSchema = z
  .object({
    roundCount: z.number().int().min(3).max(9),
    seedingStrategy: z.enum(SWISS_SEEDING_STRATEGIES),
    /**
     * Persisted when the draw was random, so it can be replayed. Without it a
     * contested draw is unreproducible the moment the round is regenerated.
     */
    seedingRandomSeed: z.number().int().nullable().optional(),
    /** The pool (or Swiss) phase `by-pool-rank` reads its order from. */
    sourcePhaseId: z.uuid().nullable().optional(),
    pairingMethod: z.enum(SWISS_PAIRING_METHODS),
    grouping: swissGroupingSchema,
    /**
     * What the STANDINGS rank on first. Independent of what the pairing GROUPS
     * on (see `grouping`) — that separation is what keeps the format Swiss:
     * a continuous score can decide the ranking without shattering the pairing
     * into groups of one.
     */
    rankBy: z.enum(['swissPts', 'rulesetScore']),
    points: swissPointsSchema,
    tiebreakChain: z.array(z.enum(SWISS_TIEBREAK_KEYS)).max(SWISS_TIEBREAK_KEYS.length),
    /**
     * `by-rating` refuses below this coverage rather than seeding unrated
     * fighters last and pretending the draw was rating-based.
     */
    minRatingCoveragePercent: z.number().min(0).max(100).nullable().optional(),
    finalized: z
      // Nullable, not an empty-string stand-in: the actor is resolved over the
      // network while the guard verifies locally, so a blip yields no user on a
      // request that was properly authenticated. Storing '' for that case wrote
      // a config this very schema then refused, which made the WHOLE phase
      // unreadable — unpairable, unviewable and impossible to resume.
      .object({ atRound: z.number().int().min(1), at: z.string(), byUserId: z.uuid().nullable() })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    // Refuse rather than degrade: a by-pool-rank phase with no source would
    // silently fall back to registration order, which is not a seeded draw.
    if (config.seedingStrategy === 'by-pool-rank' && !config.sourcePhaseId) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourcePhaseId'],
        message: 'by-pool-rank seeding requires the phase to read standings from',
      });
    }
    const duplicate = config.tiebreakChain.find(
      (key, i) => config.tiebreakChain.indexOf(key) !== i,
    );
    if (duplicate) {
      ctx.addIssue({
        code: 'custom',
        path: ['tiebreakChain'],
        message: `Tiebreak "${duplicate}" appears more than once; the second is unreachable`,
      });
    }
  });

export type SwissConfig = z.infer<typeof swissConfigSchema>;

/**
 * Read a stored `phases.config_json` as a Swiss config.
 *
 * Returns null rather than throwing so a read path can render "this phase is
 * misconfigured" instead of 500-ing the whole tournament page.
 */
export function parseSwissConfig(configJson: unknown): SwissConfig | null {
  const parsed = swissConfigSchema.safeParse(configJson);
  return parsed.success ? parsed.data : null;
}
