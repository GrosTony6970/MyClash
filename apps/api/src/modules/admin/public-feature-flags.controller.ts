import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { PublicFeatureFlagsSnapshot } from '@myclash/feature-flags';
import { AdminFeatureFlagsService } from './admin-feature-flags.service';

/**
 * GET /api/v1/public/feature-flags
 *
 * Unauthenticated snapshot of the two flags every frontend needs to
 * know about: the maintenance banner state and whether realtime is
 * disabled. Hot path — the FE polls it on mount and every 60 s — but
 * the underlying read is a single tiny query, so we keep it on the
 * global throttler default (60/min/IP) rather than fighting the
 * cache layer with @Throttle overrides. SkipThrottle would let a
 * misbehaving FE hammer us; explicit default protects us.
 */
@ApiTags('public')
@Controller('public/feature-flags')
export class PublicFeatureFlagsController {
  constructor(private readonly flags: AdminFeatureFlagsService) {}

  @Get()
  @SkipThrottle({ default: false })
  @ApiOperation({ summary: 'Public runtime flags snapshot for the frontends' })
  @ApiResponse({ status: 200, description: 'Banner + realtime state' })
  async snapshot(): Promise<PublicFeatureFlagsSnapshot> {
    return this.flags.getPublicFlagsSnapshot();
  }
}
