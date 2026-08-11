import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/public.decorator';
import { SiteStatsDto } from './dto/site-stats.dto';
import { SiteStatsService } from './site-stats.service';

/**
 * GET /api/v1/public/site-stats
 *
 * Read by the marketing site at myclash.fr, from the browser. The marketing
 * container itself never calls the API — it is static files behind Caddy, which
 * is why scripts/check-infra-review.mjs exempts it from the `depends_on: api`
 * rule that every other frontend carries. The visitor's browser makes this
 * request, and `https://myclash.fr` is already in the CORS allowlist in
 * security/http-security.ts.
 *
 * Public by necessity: it renders above the fold on a page with no login.
 * Counts only — no identifiers, no names, nothing that could be joined back to
 * a person. Left on the global throttler (120/min/IP) rather than
 * @SkipThrottle: the page calls it once on load, so the default is generous,
 * and skipping would hand an unauthenticated endpoint an unbounded budget.
 */
@ApiTags('public')
@Public()
@Controller('public/site-stats')
export class SiteStatsController {
  constructor(private readonly stats: SiteStatsService) {}

  @Get()
  @ApiOperation({ summary: 'Public adoption counts for the marketing site' })
  @ApiResponse({ status: 200, type: SiteStatsDto })
  async get(): Promise<SiteStatsDto> {
    return this.stats.getPublicStats();
  }
}
