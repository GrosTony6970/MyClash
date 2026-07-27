import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { doubleElimPodiumFields, refineDoubleElimPodium } from './double-elim-podium';
import { SEEDING_STRATEGIES } from './reseed-bracket.dto';

const generatePoolsSchema = z
  .object({
    /**
     * Explicit number of pools. Mutually exclusive with targetSize.
     * If neither provided, defaults to targetSize=8.
     */
    poolCount: z.number().int().min(1).optional(),
    /**
     * Target fighters per pool (e.g. 8 → ceil(fighters/8) pools).
     * Mutually exclusive with poolCount.
     */
    targetSize: z.number().int().min(2).max(20).optional(),
    /** Enforce school (club) separation across pools (default: true) */
    enforceSchoolSeparation: z.boolean().optional(),
    /** Enforce skill balance across pools (default: true) */
    enforceSkillBalance: z.boolean().optional(),
    /** PRNG seed for deterministic generation (default: 42) */
    seed: z.number().int().optional(),
    /** Lice ID to assign matches to (optional — assigns all to one Lice if provided) */
    liceId: z.uuid().optional(),
    /** Prevent a referee from being scheduled back-to-back across pools (default: true) */
    enforceRefereeNoBackToBack: z.boolean().optional(),
    /** Number of pool slots a referee must rest between officiating duties (default: 1) */
    refereeRestMinSlots: z.number().int().min(0).max(10).optional(),
    /** Ensure competing referees get a rest between the pool they ref and the pool they fight in (default: true) */
    enforceDedicatedRefereeRest: z.boolean().optional(),
    /** Never schedule a fighter to referee the same pool they're fighting in (default: true) */
    enforceFighterRefereeNoOverlap: z.boolean().optional(),
    /** Prefer referees with higher ratings when multiple candidates are available (default: true) */
    preferHighRatedReferees: z.boolean().optional(),
  })
  .strict();
export class GeneratePoolsDto extends createZodDto(generatePoolsSchema) {}

const generateBracketSchema = z
  .object({
    /**
     * Bracket format. `single_elim` (default) generates a single-elimination
     * tree; `double_elim` adds a losers bracket plus optional grand-final
     * reset. The phases.service consumes this to pick the right scheduler.
     */
    phaseType: z.enum(['single_elim', 'double_elim']).optional(),
    /**
     * Double-elim only: if true and the lower-bracket finalist beats the
     * upper-bracket finalist in the grand final, run a "reset" match to
     * decide the title. Ignored when phaseType is single_elim.
     */
    grandFinalReset: z.boolean().optional(),
    /**
     * Number of fighters to qualify from the pool phase (top N by standings).
     * Defaults to next power of 2 ≤ total pool finishers.
     */
    qualifyCount: z.number().int().min(2).optional(),
    /**
     * Explicit bracket size (must be power of 2, ≥ qualifyCount, and ≤ 128).
     */
    bracketSize: z.number().int().min(2).max(128).optional(),
    /** Phase ID of the pool phase to read standings from */
    poolPhaseId: z.uuid().optional(),
    /**
     * Seeding strategy stamped onto the phase config. generateBracket only
     * builds the bracket STRUCTURE — the strategy is consumed later by
     * populateBracket (and by an explicit reseed), which is where the R1 rank
     * order is actually resolved. See r1-ranking.ts.
     */
    seedingStrategy: z.enum(SEEDING_STRATEGIES).optional(),
    ...doubleElimPodiumFields,
  })
  .strict()
  .superRefine(refineDoubleElimPodium);
export class GenerateBracketDto extends createZodDto(generateBracketSchema) {}

const updatePhaseVisibilitySchema = z
  .object({
    visibility: z.enum(['hidden', 'published']),
    confirmStarted: z.boolean().optional(),
  })
  .strict();
export class UpdatePhaseVisibilityDto extends createZodDto(updatePhaseVisibilitySchema) {}

const updateBracketSlotSchema = z
  .object({
    registrationAId: z.uuid().nullish(),
    registrationBId: z.uuid().nullish(),
  })
  .strict();
export class UpdateBracketSlotDto extends createZodDto(updateBracketSlotSchema) {}
