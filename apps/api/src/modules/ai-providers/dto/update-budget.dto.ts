import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const updateBudgetSchema = z
  .object({
    // Monthly AI budget in EUR. null = unlimited.
    monthlyBudgetEur: z.number().nonnegative().nullable(),
  })
  .strict();
export class UpdateBudgetDto extends createZodDto(updateBudgetSchema) {}
