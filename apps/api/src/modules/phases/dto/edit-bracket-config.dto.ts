import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { doubleElimPodiumFields, refineDoubleElimPodium } from './double-elim-podium';

/**
 * Post-generation bracket configuration edit (double-elim).
 *
 * Accepts the same podium options as generation and validates them the same
 * way. Whether a given change can be applied WITHOUT regenerating the bracket
 * is a separate question the service answers: `grandFinalReset` adds or removes
 * a single conditional slot and is safe, while the podium model and the
 * repechage cutoff reshape the whole losers bracket and are refused with a
 * pointer to regenerate.
 */
const editBracketConfigSchema = z
  .object({
    grandFinalReset: z.boolean().optional(),
    ...doubleElimPodiumFields,
  })
  .strict()
  .superRefine(refineDoubleElimPodium);
export class EditBracketConfigDto extends createZodDto(editBracketConfigSchema) {}
