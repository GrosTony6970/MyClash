import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Pilot DTO for the class-validator → Zod migration (adopted standard #1).
 * `.strict()` rejects unknown fields, preserving the global pipe's
 * `forbidNonWhitelisted` behaviour.
 */
export const passwordLoginSchema = z
  .object({
    email: z.email(),
    password: z.string().min(1),
    /** Optional redirect path after successful auth (validated server-side). */
    redirectTo: z.string().optional(),
  })
  .strict();

export class PasswordLoginDto extends createZodDto(passwordLoginSchema) {}
