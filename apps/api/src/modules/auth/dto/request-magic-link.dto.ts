import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const requestMagicLinkSchema = z
  .object({
    email: z.email(),
    /**
     * 'login'        — organizer / claimed-user login (admin app)
     * 'public_login' — participant personal-space login (public app)
     * 'claim'        — participant claiming their Person profile (public app)
     */
    type: z.enum(['login', 'public_login', 'claim']),
    /**
     * Required when type='claim'. The Person ID the participant is claiming.
     * The API verifies that persons.email matches the provided email before
     * sending the link — prevents claiming someone else's profile.
     */
    personId: z.uuid().optional(),
    /** Optional redirect path after successful auth (validated server-side). */
    redirectTo: z.string().optional(),
  })
  .strict();
export class RequestMagicLinkDto extends createZodDto(requestMagicLinkSchema) {}
