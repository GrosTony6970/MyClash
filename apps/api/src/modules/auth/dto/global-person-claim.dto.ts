import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * POST /api/v1/me/global-person-claim
 *
 * Body: a single globalPersonId — the unclaimed `global_persons` row
 * the signed-in user wants to claim. The endpoint either mails a
 * confirmation link (happy path) or, when no email is on file,
 * queues a pending request for organizer approval (handled in §8).
 */
export class GlobalPersonClaimRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  globalPersonId!: string;
}

/**
 * POST /api/v1/me/claim-confirm
 *
 * Body: the one-time token from the confirmation email. The
 * web-public `/me/claim-confirm` page posts this server-side after
 * the user clicks the magic link.
 */
export class GlobalPersonClaimConfirmDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(64)
  token!: string;
}
