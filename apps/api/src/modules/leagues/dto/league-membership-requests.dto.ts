import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createLeagueMembershipRequestBodySchema = z
  .object({
    leagueId: z.uuid(),
    message: z.string().max(1000).optional(),
    requestedRole: z.enum(['member', 'admin']).optional(),
  })
  .strict();
export class CreateLeagueMembershipRequestBodyDto extends createZodDto(
  createLeagueMembershipRequestBodySchema,
) {}

const reviewLeagueMembershipRequestBodySchema = z
  .object({
    status: z.enum(['approved', 'rejected']),
    reviewNote: z.string().max(1000).optional(),
  })
  .strict();
export class ReviewLeagueMembershipRequestBodyDto extends createZodDto(
  reviewLeagueMembershipRequestBodySchema,
) {}
