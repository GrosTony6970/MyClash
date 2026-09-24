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
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { assertCanManageEvent, MANAGE_EVENT_ROLE } from '../../common/auth/event-authz';
import { getIdentity } from '../../common/auth/identity';
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

  /**
   * The suggest box on an Event's persons page: `editor` in any organization,
   * the bar for adding a person there (operator ruling 100).
   */
  @Get('hema-ratings/search')
  @ApiOperation({ summary: 'Search latest HEMA Ratings fighter snapshot' })
  @ApiQuery({ name: 'q', type: 'string' })
  @ApiQuery({ name: 'limit', type: 'number', required: false })
  async search(@Query() query: HemaRatingsSearchQueryDto, @Req() req: FastifyRequest) {
    const identity = getIdentity(req);
    if (identity.kind === 'anonymous') {
      throw new UnauthorizedException('Authentication required');
    }
    await this.orgs.assertAnyOrgRole(
      identity.kind === 'claimed' ? identity.userId : null,
      'editor',
    );
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
   * sibling `GET hema-ratings/search` above reaches the same outbound fetch and
   * snapshot write, but only for ids the snapshot already holds, only for an
   * `editor` somewhere, and not while `disable_hema_sync` is on (ruling 100).
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
