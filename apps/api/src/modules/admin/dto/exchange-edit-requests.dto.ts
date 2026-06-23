import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const listExchangeEditRequestsSchema = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
  })
  .strict();
export class ListExchangeEditRequestsDto extends createZodDto(listExchangeEditRequestsSchema) {}

const rejectExchangeEditRequestSchema = z.object({ reason: z.string() }).strict();
export class RejectExchangeEditRequestDto extends createZodDto(rejectExchangeEditRequestSchema) {}
