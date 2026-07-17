import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/auth/public.decorator';
import { HealthResponseDto } from './dto/health-response.dto';

/** Start time captured once at module load — used to compute uptime. */
const START_TIME = Date.now();

@ApiTags('ops')
@Public()
@Controller()
export class HealthController {
  /**
   * GET /health
   *
   * Lightweight liveness probe used by:
   * - Docker healthchecks
   * - infra/scripts/status.sh
   * - infra/scripts/deploy.sh smoke test
   *
   * Returns HTTP 200 as long as the process is alive.
   * Does NOT check DB or Redis — those are checked by /health/deep (T-061).
   *
   * @Public() is mandatory here, not cosmetic: main.ts excludes /health from the
   * api/v1 *prefix*, which is not guard exclusion — a global guard still runs on
   * it. Without this, AuthGuard in enforce mode 401s the probe and takes down the
   * container healthcheck and the deploy/rollback smoke tests at the same time.
   */
  @Get('health')
  @SkipThrottle({ global: true })
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({
    status: 200,
    description: 'Service is alive',
    type: HealthResponseDto,
  })
  getHealth(): HealthResponseDto {
    return {
      status: 'ok',
      uptime: (Date.now() - START_TIME) / 1000,
    };
  }
}
