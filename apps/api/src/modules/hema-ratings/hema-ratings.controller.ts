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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { assertCanManageEvent, MANAGE_EVENT_ROLE } from '../../common/auth/event-authz';
import { requireRequestUserId } from '../../common/auth/request-user';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { HemaRatingsService } from './hema-ratings.service';

const hemaRatingsSearchQuerySchema = z
  .object({
    q: z.string().max(100),
    // Arrives as a query-string value; the controller parses it via parseInt.
    limit: z.string().optional(),
  })
  .strict();
class HemaRatingsSearchQueryDto extends createZodDto(hemaRatingsSearchQuerySchema) {}

/**
 * Unprefixed, because its two routes sit at different depths: the search is
 * platform-wide, and the sync is scoped to the Event whose picker triggered it.
 */
@ApiTags('hema-ratings')
@Controller()
export class HemaRatingsController {
  constructor(
    private readonly hemaRatings: HemaRatingsService,
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  @Get('hema-ratings/search')
  @ApiOperation({ summary: 'Search latest HEMA Ratings fighter snapshot' })
  @ApiQuery({ name: 'q', type: 'string' })
  @ApiQuery({ name: 'limit', type: 'number', required: false })
  async search(@Query() query: HemaRatingsSearchQueryDto) {
    const limit = parseInt(query.limit ?? '5', 10) || 5;
    return this.hemaRatings.search(query.q, limit);
  }

  // (`GET :id` was removed — no frontend consumed it; the service-level
  // getProfile stays for fighters.service enrichment.)

  /**
   * Background sync of a single HEMA Ratings ID. Called by the
   * participant-add finder as fire-and-forget the moment the user picks
   * a suggestion — refreshes the snapshot entry so the next read
   * (search, registration enrichment, rating resolution) gets fresh
   * data without waiting on a full daily sync.
   *
   * Returns 202 immediately; the actual fetch + snapshot patch happen
   * before the response resolves but errors are intentionally swallowed
   * inside the service so a flaky upstream never surfaces to the form.
   *
   * Under the Event, and `editor` on it (operator ruling 38). It asked nobody
   * until 2026-09-23, and with the AuthGuard in shadow mode that meant an
   * unauthenticated caller. Its one caller is the picker on that Event's
   * persons page, and `editor` is the bar for adding a person there, so the
   * Event it belongs to is the one that decides.
   *
   * What moved is the ARBITRARY id: this took any string and fetched it. The
   * sibling `GET hema-ratings/search` above still reaches the same outbound
   * fetch and the same snapshot write (`search` → `fetchHemaRatingsProfile` +
   * `patchSnapshotEntry`, `hema-ratings.service.ts`) for anyone, and unlike
   * this route it does NOT honour the `disable_hema_sync` kill switch. It can
   * only refresh ids the snapshot already holds, which is the narrowing; a bar
   * for it is ruling 15's read pass, and it is still on the ledger.
   */
  @Post('events/:eventId/hema-ratings/fighters/:hemaRatingsId/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Background-sync a single HEMA Ratings fighter (editor+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'hemaRatingsId', type: 'string' })
  async sync(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('hemaRatingsId') hemaRatingsId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await requireRequestUserId(req, this.supabase);
    await assertCanManageEvent(
      { supabase: this.supabase, orgs: this.orgs },
      eventId,
      userId,
      MANAGE_EVENT_ROLE,
    );
    await this.hemaRatings.syncByHemaRatingsId(hemaRatingsId);
    return { accepted: true };
  }
}
