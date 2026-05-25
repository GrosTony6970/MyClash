import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { HemaRatingsService } from '../hema-ratings/hema-ratings.service';
import { SuperAdminGuard } from './guards/super-admin.guard';

/**
 * Super-admin surface for the HEMA Ratings sync system.
 *
 * Endpoints under /api/v1/admin/hema-ratings:
 *   GET    /fighters                              List tracked global_persons + latest ratings
 *   GET    /sync-history?limit=N                  Last N sync runs (default 10)
 *   POST   /sync                                  Enqueue an immediate sync run
 *   POST   /fighters/:globalPersonId/refresh      Refresh one profile in place
 *   GET    /health                                Probe hemaratings.com (latency + status)
 *
 * All routes gated by `SuperAdminGuard`. Inline edit of `hema_ratings_id`
 * goes through the existing global_persons PATCH endpoint — no new route here.
 */
@ApiTags('admin')
@ApiCookieAuth('sb-access-token')
@UseGuards(SuperAdminGuard)
@Controller('admin/hema-ratings')
export class HemaRatingsAdminController {
  constructor(private readonly hemaRatings: HemaRatingsService) {}

  @Get('fighters')
  @ApiOperation({ summary: 'List global_persons with a hema_ratings_id + their latest ratings' })
  listTrackedFighters() {
    return this.hemaRatings.listTrackedFighters();
  }

  @Get('sync-history')
  @ApiOperation({ summary: 'Recent HEMA Ratings sync runs (newest first)' })
  getSyncHistory(@Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : 10;
    return this.hemaRatings.getSyncHistory(Number.isFinite(parsed) ? parsed : 10);
  }

  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Enqueue an immediate HEMA Ratings sync job' })
  enqueueSync(@Req() req: FastifyRequest) {
    const actorUserId =
      (req as FastifyRequest & { actorUserId?: string }).actorUserId ?? 'super-admin';
    return this.hemaRatings.enqueueSync(actorUserId);
  }

  @Post('fighters/:globalPersonId/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh a single fighter profile from hemaratings.com in place' })
  @ApiParam({ name: 'globalPersonId', type: 'string', format: 'uuid' })
  refreshSingleFighter(@Param('globalPersonId', ParseUUIDPipe) globalPersonId: string) {
    return this.hemaRatings.refreshSingleFighter(globalPersonId);
  }

  @Get('health')
  @ApiOperation({ summary: 'Probe hemaratings.com — returns status + latency' })
  checkHealth() {
    return this.hemaRatings.checkHealth();
  }
}
