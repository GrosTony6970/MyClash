import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthResponseDto } from './dto/health-response.dto';

/** Start time captured once at module load — used to compute uptime. */
const START_TIME = Date.now();

@ApiTags('ops')
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
   */
  @Get('health')
  @SkipThrottle({ global: true, auth: true })
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
