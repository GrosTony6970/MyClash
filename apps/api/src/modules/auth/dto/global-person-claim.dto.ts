import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * POST /api/v1/me/global-person-claim
 *
 * Body: a single globalPersonId — the unclaimed `global_persons` row
 * the signed-in user wants to claim. The endpoint either mails a
 * confirmation link (happy path) or, when no email is on file,
 * queues a pending request for organizer approval (handled in §8).
 */
const globalPersonClaimRequestSchema = z.object({ globalPersonId: z.uuid() }).strict();
export class GlobalPersonClaimRequestDto extends createZodDto(globalPersonClaimRequestSchema) {}

/**
 * POST /api/v1/me/claim-confirm
 *
 * Body: the one-time token from the confirmation email. The
 * web-public `/me/claim-confirm` page posts this server-side after
 * the user clicks the magic link.
 */
const globalPersonClaimConfirmSchema = z.object({ token: z.string().min(20).max(64) }).strict();
export class GlobalPersonClaimConfirmDto extends createZodDto(globalPersonClaimConfirmSchema) {}
