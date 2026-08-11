import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const submitEventFeedbackSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(2000).nullable().optional(),
    /**
     * The respondent ticked "sign this feedback". Defaults to FALSE: silence
     * means anonymous, because the person who does not read the box is exactly
     * the one anonymity is there to protect.
     */
    isAttributed: z.boolean().optional(),
  })
  .strict();

export class SubmitEventFeedbackDto extends createZodDto(submitEventFeedbackSchema) {}
