import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  DEFAULT_SWISS_POINTS,
  DEFAULT_SWISS_TIEBREAK_CHAIN,
  SWISS_PAIRING_METHODS,
  SWISS_SEEDING_STRATEGIES,
  SWISS_TIEBREAK_KEYS,
  swissGroupingSchema,
  swissPointsSchema,
} from './swiss-config.dto';

/**
 * Generate a Swiss phase.
 *
 * Every field is optional and defaulted server-side, so the simplest possible
 * call — POST with an empty body — produces a sensible phase: recommended round
 * count for the field size, a random draw, fold pairing on Swiss points.
 */
const generateSwissSchema = z
  .object({
    roundCount: z.number().int().min(3).max(9).optional(),
    seedingStrategy: z.enum(SWISS_SEEDING_STRATEGIES).optional(),
    /** Replay a previous draw exactly; generated when omitted. */
    seedingRandomSeed: z.number().int().nullable().optional(),
    /** Required by `by-pool-rank` — the completed phase to read order from. */
    sourcePhaseId: z.uuid().nullable().optional(),
    pairingMethod: z.enum(SWISS_PAIRING_METHODS).optional(),
    grouping: swissGroupingSchema.optional(),
    rankBy: z.enum(['swissPts', 'rulesetScore']).optional(),
    points: swissPointsSchema.optional(),
    tiebreakChain: z.array(z.enum(SWISS_TIEBREAK_KEYS)).optional(),
    minRatingCoveragePercent: z.number().min(0).max(100).nullable().optional(),
  })
  .strict();
export class GenerateSwissDto extends createZodDto(generateSwissSchema) {}

/**
 * Edit a live phase's config.
 *
 * Deliberately narrower than generation: the service refuses changes to
 * `pairingMethod`, `points` and `grouping` once round 2 exists, because those
 * three retroactively change what the rounds already played were worth.
 */
const updateSwissConfigSchema = z
  .object({
    roundCount: z.number().int().min(3).max(9).optional(),
    pairingMethod: z.enum(SWISS_PAIRING_METHODS).optional(),
    grouping: swissGroupingSchema.optional(),
    rankBy: z.enum(['swissPts', 'rulesetScore']).optional(),
    points: swissPointsSchema.optional(),
    tiebreakChain: z.array(z.enum(SWISS_TIEBREAK_KEYS)).optional(),
    minRatingCoveragePercent: z.number().min(0).max(100).nullable().optional(),
  })
  .strict();
export class UpdateSwissConfigDto extends createZodDto(updateSwissConfigSchema) {}

/**
 * Swap two fighters between pairings — the DEFAULT override.
 *
 * Invariant-preserving by construction: exchanging two fighters leaves everyone
 * appearing exactly once and leaves exactly one bye. Either fighter may be the
 * bye holder, so "give the bye to someone else" is the same operation rather
 * than a special case.
 */
const swapPairingSchema = z
  .object({
    aRegistrationId: z.uuid(),
    bRegistrationId: z.uuid(),
    /** Proceed despite a warning (rematch created, repeat bye, same club). */
    confirm: z.boolean().optional(),
  })
  .strict();
export class SwapPairingDto extends createZodDto(swapPairingSchema) {}

/**
 * Set both sides of one match directly — the ESCAPE HATCH.
 *
 * Unlike a swap this CAN break the round: it writes whoever it is told to, so a
 * fighter can end up in two bouts or in none. Every write runs
 * `validateSwissRound`, and an invalid round blocks the next one from being
 * committed.
 */
const setSwissSidesSchema = z
  .object({
    redRegistrationId: z.uuid().nullable(),
    blueRegistrationId: z.uuid().nullable(),
    confirm: z.boolean().optional(),
  })
  .strict();
export class SetSwissSidesDto extends createZodDto(setSwissSidesSchema) {}

const withdrawSwissSchema = z.object({ registrationId: z.uuid() }).strict();
export class WithdrawSwissDto extends createZodDto(withdrawSwissSchema) {}

const finaliseSwissSchema = z.object({ confirm: z.boolean().optional() }).strict();
export class FinaliseSwissDto extends createZodDto(finaliseSwissSchema) {}

export const SWISS_DEFAULTS = {
  pairingMethod: 'fold' as const,
  grouping: { kind: 'points' } as const,
  rankBy: 'swissPts' as const,
  points: DEFAULT_SWISS_POINTS,
  tiebreakChain: DEFAULT_SWISS_TIEBREAK_CHAIN,
  seedingStrategy: 'random' as const,
};
