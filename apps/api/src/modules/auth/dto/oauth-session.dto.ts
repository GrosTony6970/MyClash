import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const oAuthSessionSchema = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    mode: z.enum(['admin_login', 'organizer_signup', 'person_claim', 'public_login']),
    personId: z.uuid().optional(),
    orgName: z.string().optional(),
    orgSlug: z.string().optional(),
    next: z.string().optional(),
  })
  .strict();
export class OAuthSessionDto extends createZodDto(oAuthSessionSchema) {}
