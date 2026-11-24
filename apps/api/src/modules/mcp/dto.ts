import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** The person's answer to a Claude connection request. */
const answerConsentSchema = z.object({ action: z.enum(['approve', 'deny']) }).strict();
export class AnswerConsentDto extends createZodDto(answerConsentSchema) {}
