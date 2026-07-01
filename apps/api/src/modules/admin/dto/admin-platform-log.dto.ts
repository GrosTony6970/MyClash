import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Query DTO: every value arrives as a string. `page`/`perPage` stay strings
// (the service parses them via Number.parseInt, matching the audit-log DTO).
// `category`/`severity` are free strings — the service filters against its
// known set and treats an unknown value as "matches nothing" rather than 400.
const listPlatformLogQuerySchema = z
  .object({
    category: z.string().optional(),
    severity: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    page: z.string().optional(),
    perPage: z.string().optional(),
  })
  .strict();
export class ListPlatformLogQueryDto extends createZodDto(listPlatformLogQuerySchema) {}
