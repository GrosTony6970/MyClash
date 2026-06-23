import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const requestPersonEmailChangeSchema = z.object({ newEmail: z.email() }).strict();
export class RequestPersonEmailChangeDto extends createZodDto(requestPersonEmailChangeSchema) {}
