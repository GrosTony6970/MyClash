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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { BroadcastNotificationsService } from '../notifications/broadcast-notifications.service';
import { SupabaseService } from '../supabase/supabase.service';
import { EnrollmentService } from './enrollment.service';
import { FeedbackService } from './feedback.service';
import { Public } from '../../common/auth/public.decorator';
import { WorkshopsService } from './workshops.service';

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

const createWorkshopSchema = z
  .object({
    slug: z.string(),
    title: z.string(),
    shortDescription: z.string().nullish(),
    descriptionMd: z.string().nullish(),
    category: z.string().nullish(),
    level: z.string().nullish(),
    weapon: z.string().nullish(),
    language: z.string().nullish(),
    capacity: z.number().int().min(1).nullish(),
    durationMinutes: z.number().int().min(1).nullish(),
    status: z.enum(WORKSHOP_STATUSES).nullish(),
    color: z.string().nullish(),
    venueId: z.uuid().nullish(),
  })
  .strict();
class CreateWorkshopBody extends createZodDto(createWorkshopSchema) {}

const updateWorkshopSchema = z
  .object({
    title: z.string().optional(),
    shortDescription: z.string().nullish(),
    descriptionMd: z.string().nullish(),
    category: z.string().nullish(),
    level: z.string().nullish(),
    weapon: z.string().nullish(),
    language: z.string().nullish(),
    capacity: z.number().int().min(1).nullish(),
    durationMinutes: z.number().int().min(1).nullish(),
    status: z.enum(WORKSHOP_STATUSES).nullish(),
    color: z.string().nullish(),
    // Logo is set via POST /workshops/:id/logo; the update path only
    // carries it so the operator can clear it (send null).
    coverImageUrl: z.string().nullish(),
    venueId: z.uuid().nullish(),
  })
  .strict();
class UpdateWorkshopBody extends createZodDto(updateWorkshopSchema) {}

// Instructor-scoped edit: only the four fields an instructor may change.
// `.nullish()` (= nullable + optional) lets the FE send null to clear a field.
const instructorUpdateWorkshopSchema = z
  .object({
    weapon: z.string().nullish(),
    descriptionMd: z.string().nullish(),
    level: z.string().nullish(),
    language: z.string().nullish(),
  })
  .strict();
class InstructorUpdateWorkshopBody extends createZodDto(instructorUpdateWorkshopSchema) {}

const notifyWorkshopSchema = z
  .object({
    title: z.string().min(1).max(120),
    body: z.string().min(1).max(1000),
  })
  .strict();
class NotifyWorkshopBody extends createZodDto(notifyWorkshopSchema) {}

const submitFeedbackSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(2000).nullish(),
  })
  .strict();
class SubmitFeedbackBody extends createZodDto(submitFeedbackSchema) {}

const createSessionSchema = z
  .object({
    startTime: z.iso.datetime(),
    endTime: z.iso.datetime(),
    location: z.string().optional(),
    status: z.enum(['scheduled', 'running', 'completed', 'cancelled']).optional(),
    venueId: z.uuid().nullish(),
    areaId: z.uuid().nullish(),
  })
  .strict();
class CreateSessionBody extends createZodDto(createSessionSchema) {}

const addInstructorSchema = z.object({ globalPersonId: z.uuid() }).strict();
class AddInstructorBody extends createZodDto(addInstructorSchema) {}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const createBreakSchema = z
  .object({
    dayIndex: z.number().int().min(0).optional(),
    startTime: z.string().regex(HHMM_RE),
    endTime: z.string().regex(HHMM_RE),
    label: z.string().nullish(),
    color: z.string().nullish(),
  })
  .strict();
class CreateBreakBody extends createZodDto(createBreakSchema) {}

const updateBreakSchema = z
  .object({
    dayIndex: z.number().int().min(0).optional(),
    startTime: z.string().regex(HHMM_RE).optional(),
    endTime: z.string().regex(HHMM_RE).optional(),
    label: z.string().nullish(),
    color: z.string().nullish(),
  })
  .strict();
class UpdateBreakBody extends createZodDto(updateBreakSchema) {}

// ── Controller ────────────────────────────────────────────────────────────────

@ApiTags('workshops')
@ApiBearerAuth()
@Controller()
export class WorkshopsController {
  constructor(
    private readonly workshops: WorkshopsService,
    private readonly enrollment: EnrollmentService,
    private readonly supabase: SupabaseService,
    private readonly broadcasts: BroadcastNotificationsService,
    private readonly feedback: FeedbackService,
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

  @Public()
  @Get('events/:eventSlug/public-workshops')
  @ApiOperation({ summary: 'List public (published+) workshops for an event by slug' })
  @ApiParam({ name: 'eventSlug', type: 'string' })
  async listPublic(@Param('eventSlug') eventSlug: string) {
    return this.workshops.listPublicWorkshops(eventSlug);
  }

  @Public()
  @Get('workshops/slug/:slug')
  @ApiOperation({ summary: 'Get a public workshop by event slug + workshop slug' })
  @ApiParam({ name: 'slug', type: 'string' })
  async getPublicBySlug(
    @Param('slug') slug: string,
    @Query('eventSlug') eventSlug: string,
    @Req() req: FastifyRequest,
  ) {
    // Stays @Public() — anonymous browsing is the norm here. The identity is
    // read opportunistically, only to set `viewerIsInstructor` for the caller.
    return this.workshops.getPublicWorkshopBySlug(
      eventSlug,
      slug,
      await getUserId(req, this.supabase),
    );
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

  @Patch('workshops/:id/instructor')
  @ApiOperation({
    summary: 'Edit weapon/description/level/language (workshop instructor or workshop_lead+)',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async instructorUpdate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InstructorUpdateWorkshopBody,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.workshops.updateWorkshopByInstructor(id, dto, userId);
  }

  @Post('workshops/:id/notify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Message all enrollees of a workshop (workshop instructor or workshop_lead+)',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async notifyEnrollees(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NotifyWorkshopBody,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.workshops.assertCanManageWorkshopAsInstructorOrLead(id, userId);
    const { eventId, personIds } = await this.workshops.getWorkshopEnrolleeRecipients(id);
    if (personIds.length === 0) return { id: null, recipientCount: 0 };
    return this.broadcasts.sendToEventPersons(eventId, userId, personIds, dto.title, dto.body);
  }

  // ── Workshop feedback (ratings) ─────────────────────────────────────────────────

  @Post('workshops/:id/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit/update your rating for a workshop (enrolled + started)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async submitFeedback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitFeedbackBody,
    @Req() req: FastifyRequest,
  ) {
    const personId = await this.resolvePersonIdForWorkshop(req, id);
    return this.feedback.submitFeedback(id, personId, dto.rating, dto.comment ?? null);
  }

  @Get('workshops/:id/my-feedback')
  @ApiOperation({ summary: 'Your existing rating for a workshop (prefill)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async myFeedback(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const personId = await this.resolvePersonIdForWorkshop(req, id);
    return this.feedback.getMyFeedback(id, personId);
  }

  @Get('workshops/:id/feedback')
  @ApiOperation({
    summary: 'Anonymous feedback for a workshop (workshop instructor or workshop_lead+)',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async workshopFeedback(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    await this.workshops.assertCanManageWorkshopAsInstructorOrLead(id, userId);
    return this.feedback.getWorkshopFeedback(id);
  }

  /** POST /api/v1/workshops/:id/logo — square logo (workshop_lead+). */
  @Post('workshops/:id/logo')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Upload workshop logo (workshop_lead+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async uploadLogo(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    const data = await (
      req as FastifyRequest & {
        file: () => Promise<
          { filename: string; mimetype: string; toBuffer: () => Promise<Buffer> } | undefined
        >;
      }
    ).file();
    const buffer = data ? await data.toBuffer() : Buffer.alloc(0);
    return this.workshops.uploadLogo(id, userId, {
      buffer,
      filename: data?.filename ?? '',
      mimetype: data?.mimetype ?? '',
    });
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
  @ApiOperation({ summary: 'Get session roster (workshop instructor, or workshop_lead+)' })
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
    const personId = await this.resolvePersonId(req, id);
    return this.enrollment.enroll(id, personId);
  }

  @Delete('workshop-sessions/:id/enroll')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel enrollment (authenticated)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const personId = await this.resolvePersonId(req, id);
    await this.enrollment.cancel(id, personId);
  }

  @Post('workshop-sessions/:id/enrollments/:personId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Enroll a specified person into a session — organizer adds an attendee (workshop_lead+). Waitlisted if full.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  async enrollPerson(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.workshops.authorizeSession(id, await getUserId(req, this.supabase));
    return this.enrollment.enroll(id, personId);
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

  @Post('workshop-sessions/:id/enrollments/:personId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Accept an enrollee — confirm a waitlisted/refused person (workshop instructor or workshop_lead+)',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  async acceptEnrollee(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.workshops.assertCanManageSessionAsInstructorOrLead(
      id,
      await getUserId(req, this.supabase),
    );
    await this.enrollment.accept(id, personId);
    return { ok: true };
  }

  @Post('workshop-sessions/:id/enrollments/:personId/refuse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Refuse an enrollee — soft-remove, blocks re-registration (workshop instructor or workshop_lead+)',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  async refuseEnrollee(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.workshops.assertCanManageSessionAsInstructorOrLead(
      id,
      await getUserId(req, this.supabase),
    );
    await this.enrollment.refuse(id, personId);
    return { ok: true };
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  private async resolvePersonId(req: FastifyRequest, sessionId: string): Promise<string> {
    return this.resolvePersonIdForEvent(req, await this.eventIdForSession(sessionId));
  }

  /** Workshop-scoped variant (feedback is per-workshop, not per-session). */
  private async resolvePersonIdForWorkshop(
    req: FastifyRequest,
    workshopId: string,
  ): Promise<string> {
    const { data } = await this.supabase.service
      .from('workshops')
      .select('event_id')
      .eq('id', workshopId)
      .maybeSingle();
    const eventId = (data as { event_id?: string } | null)?.event_id ?? null;
    return this.resolvePersonIdForEvent(req, eventId);
  }

  /**
   * Resolve the caller to an EVENT-SCOPED persons.id. A user claimed in several
   * events has one persons row per event; scoping to `eventId` keeps the write on
   * the right person. Falls back to the guest session's person_id.
   */
  private async resolvePersonIdForEvent(
    req: FastifyRequest,
    eventId: string | null,
  ): Promise<string> {
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;

    const accessToken = cookies?.['sb-access-token'];
    if (accessToken) {
      const { data } = await this.supabase.anon.auth.getUser(accessToken);
      if (data.user) {
        let query = this.supabase.service
          .from('persons')
          .select('id')
          .eq('claimed_by_user_id', data.user.id);
        if (eventId) query = query.eq('event_id', eventId);
        const { data: person } = await query.maybeSingle();
        if (person) return (person as { id: string }).id;
      }
    }

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

  /** Resolve a workshop session's owning event id (session → workshop → event). */
  private async eventIdForSession(sessionId: string): Promise<string | null> {
    const { data } = await this.supabase.service
      .from('workshop_sessions')
      .select('workshops ( event_id )')
      .eq('id', sessionId)
      .maybeSingle();
    const raw = (data as { workshops?: unknown } | null)?.workshops;
    const workshop = (Array.isArray(raw) ? raw[0] : raw) as { event_id?: string } | null;
    return workshop?.event_id ?? null;
  }
}
