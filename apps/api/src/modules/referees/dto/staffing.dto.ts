import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * A single staffing slot inside a phase-type's config.
 *
 * `index` is dense (1..6) within a phase_type — the service writes
 * sequential slot_index values; reading rebuilds the dense list.
 * `allowedSkillIds` MUST contain at least one referee_skills.id.
 */
const staffingSlotSchema = z
  .object({
    index: z.number().int().min(1).max(6),
    displayName: z.string().max(100).nullish(),
    allowedSkillIds: z.array(z.string()).min(1).max(20),
  })
  .strict();
export class StaffingSlotDto extends createZodDto(staffingSlotSchema) {}

/**
 * Whole-config payload for a (tournament|event) PUT. The phase-type
 * arrays are independent and can each carry 1..6 slots.
 */
const staffingConfigPayloadSchema = z
  .object({
    pool: z.array(staffingSlotSchema).min(1).max(6),
    /**
     * Optional, and the schema is `.strict()` — making it required would 400
     * every PUT from a client that predates the Swiss format. Omitting it
     * writes no Swiss rows, and the resolver seeds the bucket from `pool`.
     */
    swiss: z.array(staffingSlotSchema).min(1).max(6).optional(),
    bracket: z.array(staffingSlotSchema).min(1).max(6),
    finals: z.array(staffingSlotSchema).min(1).max(6),
    /**
     * When true, the caller has reviewed the affected-assignment list and
     * accepts that those `referee_assignments` rows will be deleted as
     * part of this write. When false (default), the service throws
     * ConflictException listing the affected assignments instead.
     */
    confirmDestructive: z.boolean().optional(),
  })
  .strict();
export class StaffingConfigPayloadDto extends createZodDto(staffingConfigPayloadSchema) {}
