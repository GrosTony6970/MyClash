import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Body for PUT /api/v1/pools/:poolId/referee-role-assignments: one referee for one role
 * on every bout of the Pool (the Pools page's Pool strip). It was an untyped body.
 */
const poolRefereeRoleSchema = z
  .object({
    role: z.string().min(1),
    // Null clears the role on every bout of the Pool.
    refereeId: z.uuid().nullable(),
    /** Go ahead over Discouraged reasons (ADR-016). Never overrides an Impossible one. */
    confirm: z.boolean().optional(),
  })
  .strict();
export class PoolRefereeRoleDto extends createZodDto(poolRefereeRoleSchema) {}
