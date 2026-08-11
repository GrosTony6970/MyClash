import { ApiProperty } from '@nestjs/swagger';

/**
 * Counts published on the marketing site's stats band.
 *
 * Counts only. Nothing here identifies anybody, which is what makes it safe to
 * serve unauthenticated from the apex domain.
 */
export class SiteStatsDto {
  @ApiProperty({
    description:
      'Public events — status published/running/completed, excluding test events. Same predicate the public event list uses.',
    example: 7,
  })
  events!: number;

  @ApiProperty({ description: 'Clubs known to the platform.', example: 12 })
  clubs!: number;

  @ApiProperty({
    description: 'Platform-wide identities flagged as fighters.',
    example: 214,
  })
  fighters!: number;
}
