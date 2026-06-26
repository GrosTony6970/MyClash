import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { VenuesService } from './venues.service';

async function getUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) throw new UnauthorizedException('Authentication required');
  const user = await supabase.getAuthUser(token);
  if (!user?.id) throw new UnauthorizedException('Authentication required');
  return user.id;
}
import {
  CreateVenueAreaDto,
  CreateVenueDto,
  CreateVenueLiceDto,
  SetEventVenuesDto,
  UpdateVenueAreaDto,
  UpdateVenueDto,
} from './dto/venues.dto';

@ApiTags('venues')
@Controller()
export class VenuesController {
  constructor(
    private readonly venues: VenuesService,
    private readonly supabase: SupabaseService,
  ) {}

  // ── Venues (org-level catalogue) ────────────────────────────────────────────

  @Get('organizations/:orgId/venues')
  @ApiOperation({ summary: 'List venues for an organization (public read)' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async listForOrg(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.venues.listForOrg(orgId);
  }

  @Post('organizations/:orgId/venues')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a venue (org admin+)' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateVenueDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.venues.create(orgId, dto, userId);
  }

  @Get('venues/:venueId')
  @ApiOperation({ summary: 'Get a venue with its areas (public read)' })
  @ApiParam({ name: 'venueId', type: 'string', format: 'uuid' })
  async get(@Param('venueId', ParseUUIDPipe) venueId: string) {
    return this.venues.get(venueId);
  }

  @Patch('venues/:venueId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a venue (org admin+)' })
  @ApiParam({ name: 'venueId', type: 'string', format: 'uuid' })
  async update(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Body() dto: UpdateVenueDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.venues.update(venueId, dto, userId);
  }

  @Delete('venues/:venueId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Delete a venue (org admin+). Refuses while any lice or workshop session still points at it.',
  })
  @ApiParam({ name: 'venueId', type: 'string', format: 'uuid' })
  async delete(@Param('venueId', ParseUUIDPipe) venueId: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    await this.venues.delete(venueId, userId);
  }

  // ── Venue areas ─────────────────────────────────────────────────────────────

  @Post('venues/:venueId/areas')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create an area inside a venue (org admin+)' })
  @ApiParam({ name: 'venueId', type: 'string', format: 'uuid' })
  async createArea(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Body() dto: CreateVenueAreaDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.venues.createArea(venueId, dto, userId);
  }

  @Patch('venue-areas/:areaId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a venue area (org admin+)' })
  @ApiParam({ name: 'areaId', type: 'string', format: 'uuid' })
  async updateArea(
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Body() dto: UpdateVenueAreaDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.venues.updateArea(areaId, dto, userId);
  }

  @Delete('venue-areas/:areaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a venue area (org admin+)' })
  @ApiParam({ name: 'areaId', type: 'string', format: 'uuid' })
  async deleteArea(@Param('areaId', ParseUUIDPipe) areaId: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    await this.venues.deleteArea(areaId, userId);
  }

  // ── Venue lices ─────────────────────────────────────────────────────────────

  @Post('venues/:venueId/lices')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a lice inside a venue (org admin+)' })
  @ApiParam({ name: 'venueId', type: 'string', format: 'uuid' })
  async createLice(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Body() dto: CreateVenueLiceDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.venues.createLice(venueId, dto, userId);
  }

  @Delete('venue-lices/:liceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a venue lice (org admin+)' })
  @ApiParam({ name: 'liceId', type: 'string', format: 'uuid' })
  async deleteLice(@Param('liceId', ParseUUIDPipe) liceId: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    await this.venues.deleteLice(liceId, userId);
  }

  // ── Event-scoped derived listing ────────────────────────────────────────────

  @Get('events/:eventId/venues')
  @ApiOperation({
    summary:
      "Distinct venues used by this event's lices + workshop sessions. Powers the event Venue tab.",
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async listForEvent(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.venues.listForEvent(eventId);
  }

  @Put('events/:eventId/venues')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Reconcile the venues this event spreads on (org admin+). Adds links + seeds tournament lices; safe-removes (blocks venues with matches/sessions).',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async setEventVenues(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: SetEventVenuesDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.venues.setEventVenues(eventId, dto.venueIds, userId);
  }

  // ── Public slug-based variant for the public event page ────────────────────

  @Get('events/slug/:eventSlug/venues')
  @ApiOperation({
    summary: 'Public venues for an event by slug (no auth).',
  })
  @ApiParam({ name: 'eventSlug', type: 'string' })
  async listForEventSlug(@Param('eventSlug') eventSlug: string) {
    return this.venues.listForEventSlug(eventSlug);
  }
}
