import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const listRulesetsQuerySchema = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
  })
  .strict();
export class ListRulesetsQueryDto extends createZodDto(listRulesetsQuerySchema) {}

const rejectRulesetSchema = z.object({ reason: z.string().min(1) }).strict();
export class RejectRulesetDto extends createZodDto(rejectRulesetSchema) {}

const bulkApproveRulesetsSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(200),
  })
  .strict();
export class BulkApproveRulesetsDto extends createZodDto(bulkApproveRulesetsSchema) {}

const bulkRejectRulesetsSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(200),
    reason: z.string().min(1),
  })
  .strict();
export class BulkRejectRulesetsDto extends createZodDto(bulkRejectRulesetsSchema) {}
