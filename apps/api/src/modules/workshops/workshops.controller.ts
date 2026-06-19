/**
 * workshops.controller.ts — T-801 + T-802
 *
 * All workshop endpoints from ARCHITECTURE.md §14.
 *
 * Authorization: write endpoints resolve the caller via `getUserId`
 * and the service asserts the org role (`workshop_lead`+), mirroring
 * the events controller convention. Reads stay public.
 */

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
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { EnrollmentService } from './enrollment.service';
import {
  type CreateSessionDto,
  type CreateWorkshopDto,
  type UpdateWorkshopDto,
  WorkshopsService,
} from './workshops.service';

const WORKSHOP_STATUSES = ['draft', 'published', 'running', 'completed'] as const;

async function getUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) return 'anonymous';
  const user = await supabase.getAuthUser(token);
  return user?.id ?? 'anonymous';
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

class CreateWorkshopBody implements CreateWorkshopDto {
  @IsString() slug!: string;
  @IsString() title!: string;
  @IsOptional() @IsString() shortDescription?: string | null;
  @IsOptional() @IsString() descriptionMd?: string | null;
  @IsOptional() @IsString() category?: string | null;
  @IsOptional() @IsString() level?: string | null;
  @IsOptional() @IsString() language?: string | null;
  @IsOptional() @IsInt() @Min(1) capacity?: number | null;
  @IsOptional() @IsInt() @Min(1) durationMinutes?: number | null;
  @IsOptional() @IsIn(WORKSHOP_STATUSES) status?: string | null;
  @IsOptional() @IsString() color?: string | null;
  @IsOptional() @IsUUID() venueId?: string | null;
}

class UpdateWorkshopBody implements UpdateWorkshopDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() shortDescription?: string | null;
  @IsOptional() @IsString() descriptionMd?: string | null;
  @IsOptional() @IsString() category?: string | null;
  @IsOptional() @IsString() level?: string | null;
  @IsOptional() @IsString() language?: string | null;
  @IsOptional() @IsInt() @Min(1) capacity?: number | null;
  @IsOptional() @IsInt() @Min(1) durationMinutes?: number | null;
  @IsOptional() @IsIn(WORKSHOP_STATUSES) status?: string | null;
  @IsOptional() @IsString() color?: string | null;
  @IsOptional() @IsUUID() venueId?: string | null;
}

class CreateSessionBody implements CreateSessionDto {
  @IsISO8601() startTime!: string;
  @IsISO8601() endTime!: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsIn(['scheduled', 'running', 'completed', 'cancelled']) status?: string;
  @IsOptional() @IsUUID() venueId?: string | null;
  @IsOptional() @IsUUID() areaId?: string | null;
}

class AddInstructorBody {
  @IsUUID() globalPersonId!: string;
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

class CreateBreakBody {
  @IsOptional() @IsInt() @Min(0) dayIndex?: number;
  @Matches(HHMM_RE) startTime!: string;
  @Matches(HHMM_RE) endTime!: string;
  @IsOptional() @IsString() label?: string | null;
  @IsOptional() @IsString() color?: string | null;
}

class UpdateBreakBody {
  @IsOptional() @IsInt() @Min(0) dayIndex?: number;
  @IsOptional() @Matches(HHMM_RE) startTime?: string;
  @IsOptional() @Matches(HHMM_RE) endTime?: string;
  @IsOptional() @IsString() label?: string | null;
  @IsOptional() @IsString() color?: string | null;
}

// ── Controller ────────────────────────────────────────────────────────────────

@ApiTags('workshops')
@ApiBearerAuth()
@Controller()
export class WorkshopsController {
  constructor(
    private readonly workshops: WorkshopsService,
    private readonly enrollment: EnrollmentService,
    private readonly supabase: SupabaseService,
  ) {}

  // ── Workshops CRUD ────────────────────────────────────────────────────────────

  @Get('events/:eventId/workshops')
  @ApiOperation({ summary: 'List workshops for an event (organizer)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async list(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.workshops.listWorkshops(eventId);
  }

  @Post('events/:eventId/workshops')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a workshop (workshop_lead+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateWorkshopBody,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.workshops.createWorkshop(eventId, dto, userId);
  }

  @Get('workshops/:id')
  @ApiOperation({ summary: 'Get workshop detail (organizer)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.workshops.getWorkshop(id);
  }

  // ── Public reads (slug-based, status-gated; no auth) ────────────────────────────

  @Get('events/:eventSlug/public-workshops')
  @ApiOperation({ summary: 'List public (published+) workshops for an event by slug' })
  @ApiParam({ name: 'eventSlug', type: 'string' })
  async listPublic(@Param('eventSlug') eventSlug: string) {
    return this.workshops.listPublicWorkshops(eventSlug);
  }

  @Get('workshops/slug/:slug')
  @ApiOperation({ summary: 'Get a public workshop by event slug + workshop slug' })
  @ApiParam({ name: 'slug', type: 'string' })
  async getPublicBySlug(@Param('slug') slug: string, @Query('eventSlug') eventSlug: string) {
    return this.workshops.getPublicWorkshopBySlug(eventSlug, slug);
  }

  @Patch('workshops/:id')
  @ApiOperation({ summary: 'Update workshop (workshop_lead+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkshopBody,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.workshops.updateWorkshop(id, dto, userId);
  }

  // ── Instructors ───────────────────────────────────────────────────────────────

  @Post('workshops/:id/instructors')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add instructor to workshop (workshop_lead+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async addInstructor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddInstructorBody,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.workshops.addInstructor(id, dto.globalPersonId, userId);
  }

  @Delete('workshops/:id/instructors/:globalPersonId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove instructor from workshop (workshop_lead+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'globalPersonId', type: 'string', format: 'uuid' })
  async removeInstructor(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('globalPersonId', ParseUUIDPipe) globalPersonId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.workshops.removeInstructor(id, globalPersonId, userId);
  }

  // ── Event instructor roster (mirrors event referees) ───────────────────────────

  @Get('events/:eventId/instructors')
  @ApiOperation({ summary: 'List instructors tagged for an event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async listInstructors(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.workshops.listEventInstructors(eventId, userId);
  }

  @Post('events/:eventId/instructors/:personId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Tag a person as an instructor for this event (workshop_lead+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  async tagInstructor(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.workshops.tagEventInstructor(eventId, personId, userId);
  }

  @Delete('events/:eventId/instructors/:personId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Untag a person as an instructor for this event (workshop_lead+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  async untagInstructor(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.workshops.untagEventInstructor(eventId, personId, userId);
  }

  // ── Workshop-only break blocks ──────────────────────────────────────────────────

  @Get('events/:eventId/workshop-breaks')
  @ApiOperation({ summary: 'List workshop-only break blocks for an event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async listBreaks(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.workshops.listWorkshopBreaks(eventId);
  }

  @Post('events/:eventId/workshop-breaks')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a workshop break block (workshop_lead+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async createBreak(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateBreakBody,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.workshops.createWorkshopBreak(eventId, dto, userId);
  }

  @Patch('workshop-breaks/:id')
  @ApiOperation({ summary: 'Update a workshop break block (workshop_lead+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async updateBreak(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBreakBody,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.workshops.updateWorkshopBreak(id, dto, userId);
  }

  @Delete('workshop-breaks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a workshop break block (workshop_lead+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async deleteBreak(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    await this.workshops.deleteWorkshopBreak(id, userId);
  }

  // ── Sessions ──────────────────────────────────────────────────────────────────

  @Post('workshops/:id/sessions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a workshop session (workshop_lead+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async createSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSessionBody,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.workshops.createSession(id, dto, userId);
  }

  @Patch('workshop-sessions/:id')
  @ApiOperation({ summary: 'Update a workshop session (workshop_lead+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async updateSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreateSessionBody>,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.workshops.updateSession(id, dto, userId);
  }

  @Delete('workshop-sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a workshop session — unschedules the workshop (workshop_lead+)',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async deleteSession(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    await this.workshops.deleteSession(id, userId);
  }

  @Get('workshop-sessions/:id/roster')
  @ApiOperation({ summary: 'Get session roster (workshop_lead+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getRoster(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.workshops.getSessionRoster(id, userId);
  }

  // ── Enrollment ────────────────────────────────────────────────────────────────

  @Post('workshop-sessions/:id/enroll')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enroll in a session (authenticated). Waitlisted if full.' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async enroll(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const personId = await this.resolvePersonId(req);
    return this.enrollment.enroll(id, personId);
  }

  @Delete('workshop-sessions/:id/enroll')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel enrollment (authenticated)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const personId = await this.resolvePersonId(req);
    await this.enrollment.cancel(id, personId);
  }

  @Post('workshop-sessions/:id/promote/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Promote waitlisted person to confirmed (workshop_lead+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  async promote(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: FastifyRequest,
  ) {
    // userId here is personId (named userId in the API spec for consistency)
    await this.workshops.authorizeSession(id, await getUserId(req, this.supabase));
    await this.enrollment.promote(id, userId);
    return { ok: true };
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  private async resolvePersonId(req: FastifyRequest): Promise<string> {
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;

    // Try claimed user → find their person
    const accessToken = cookies?.['sb-access-token'];
    if (accessToken) {
      const { data } = await this.supabase.anon.auth.getUser(accessToken);
      if (data.user) {
        const { data: person } = await this.supabase.service
          .from('persons')
          .select('id')
          .eq('claimed_by_user_id', data.user.id)
          .maybeSingle();
        if (person) return (person as { id: string }).id;
      }
    }

    // Try guest session
    const guestToken = cookies?.['mc_guest'];
    if (guestToken) {
      // Decode without verification to get person_id (guard already verified)
      try {
        const payload = JSON.parse(
          Buffer.from(guestToken.split('.')[1] ?? '', 'base64').toString(),
        ) as { person_id?: string };
        if (payload.person_id) return payload.person_id;
      } catch {
        // Invalid token
      }
    }

    throw new Error('Authentication required');
  }
}
