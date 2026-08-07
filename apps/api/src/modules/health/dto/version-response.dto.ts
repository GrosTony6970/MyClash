import { ApiProperty } from '@nestjs/swagger';

/**
 * The public projection of deployment metadata.
 *
 * Every field here is visible to anonymous callers — see the `@Public()`
 * rationale on VersionController. Adding a field is a decision to publish it,
 * not a formatting change: the deploy manifest this is built from also holds
 * `deployedBy`, `backupFile` and the version of every piece of infrastructure,
 * all of which stay behind PlatformRoleGuard on /admin/system-versions.
 */
export class VersionResponseDto {
  @ApiProperty({
    example: 'v0.0.0',
    description: 'Release tag from the deploy manifest, falling back to the VERSION file',
  })
  version!: string;

  @ApiProperty({
    example: 'b3aa5011',
    description: 'Short (8-char) git commit the running image was built from, or "unknown"',
  })
  commit!: string;

  @ApiProperty({
    example: '2026-07-28T18:04:11.000Z',
    nullable: true,
    type: String,
    description: 'When this build was deployed; null if the deploy manifest is unavailable',
  })
  deployedAt!: string | null;

  @ApiProperty({
    example: 'production',
    description: 'Deployment environment, resolved identically to the Sentry environment tag',
  })
  environment!: string;

  @ApiProperty({ example: 3612.4, description: 'Process uptime in seconds' })
  uptime!: number;
}
