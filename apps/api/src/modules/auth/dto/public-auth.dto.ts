import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { acceptedLegalShape } from '../../../common/legal/accepted-legal.schema';

/**
 * DTOs for the public email + password account flow on app.${DOMAIN}.
 *
 * The backend's existing `passwordLogin` route refuses non-admin users
 * (via `hasAdminAccess`), so these are the parallel routes that the
 * public app sign-in / sign-up / reset forms talk to.
 */

const publicSignupSchema = z
  .object({
    email: z.email().max(254),
    password: z.string().max(256),
    // Account creation — see accepted-legal.schema.ts. Login below carries no
    // such fields: an existing account that is behind on a revised policy is
    // asked by the banner, never blocked from signing in.
    ...acceptedLegalShape,
  })
  .strict();
export class PublicSignupDto extends createZodDto(publicSignupSchema) {}

const publicLoginSchema = z
  .object({
    email: z.email().max(254),
    password: z.string().max(256),
  })
  .strict();
export class PublicLoginDto extends createZodDto(publicLoginSchema) {}

const publicPasswordResetSchema = z
  .object({
    email: z.email().max(254),
    /**
     * Which front door asked. Same vocabulary as the magic-link DTO: 'login' is
     * the admin app, 'public_login' the participant app. It selects the HOST the
     * recovery link opens — a security email that lands on a domain the person
     * did not ask about is the exact shape of a phishing attempt.
     *
     * Defaults to the participant app so the two existing callers (the public
     * login and the personal-space security page) keep their behaviour without
     * sending the field.
     */
    type: z.enum(['login', 'public_login']).default('public_login'),
  })
  .strict();
export class PublicPasswordResetDto extends createZodDto(publicPasswordResetSchema) {}

const publicPasswordResetConfirmSchema = z
  .object({
    token: z.string().min(10).max(2048),
    password: z.string().max(256),
  })
  .strict();
export class PublicPasswordResetConfirmDto extends createZodDto(publicPasswordResetConfirmSchema) {}
