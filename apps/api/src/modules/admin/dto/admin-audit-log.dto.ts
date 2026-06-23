import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Query DTO: every value arrives as a string. `page`/`perPage` are kept as
// strings (matching the original @IsString) because the service parses them
// itself via Number.parseInt and expects `string | undefined`.
const listAuditLogQuerySchema = z
  .object({
    actor: z.string().optional(),
    action: z.string().optional(),
    entityType: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    page: z.string().optional(),
    perPage: z.string().optional(),
  })
  .strict();
export class ListAuditLogQueryDto extends createZodDto(listAuditLogQuerySchema) {}
