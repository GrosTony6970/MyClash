/**
 * qualifications.controller.ts — T-901 / T-906 / T-903 (Task 3)
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
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { QualificationsService } from './qualifications.service';

const upsertQualificationSchema = z
  .object({
    personId: z.uuid(),
    role: z.string().min(1).max(80),
    rating: z.number().int().min(1).max(5).nullish(),
  })
  .strict();
class UpsertQualificationDto extends createZodDto(upsertQualificationSchema) {}

const createRefereeSkillSchema = z
  .object({
    name: z.string().min(1).max(60),
    color: z.string().max(32),
    description: z.string().max(500).optional(),
  })
  .strict();
class CreateRefereeSkillDto extends createZodDto(createRefereeSkillSchema) {}

const updateRefereeSkillSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    color: z.string().max(32).optional(),
    /** R4: editable on system skills. */
    description: z.string().max(500).optional(),
    /** R4: editable on system skills (drag-reorder support). */
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();
class UpdateRefereeSkillDto extends createZodDto(updateRefereeSkillSchema) {}

const reorderRefereeSkillsSchema = z
  .object({
    orderedSkillIds: z.array(z.string()),
  })
  .strict();
class ReorderRefereeSkillsDto extends createZodDto(reorderRefereeSkillsSchema) {}

const setSkillVisibilitySchema = z
  .object({
    isHidden: z.boolean(),
  })
  .strict();
class SetSkillVisibilityDto extends createZodDto(setSkillVisibilitySchema) {}

const updateRefereeAvailabilitySchema = z
  .object({
    availableAllTournaments: z.boolean().optional(),
    availableAllEventDuration: z.boolean().optional(),
    /** Slice 8: explicit per-tournament allowlist; replaces the row set. */
    tournamentIds: z.array(z.uuid()).optional(),
    /** Slice 8: explicit per-day allowlist (0 = event start_date). */
    dayIndices: z.array(z.number().int().min(0)).optional(),
  })
  .strict();
export class UpdateRefereeAvailabilityDto extends createZodDto(updateRefereeAvailabilitySchema) {}

/** Resolve the authenticated user UUID from the Supabase access token. */
async function getUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) throw new UnauthorizedException('Authentication required');
  const user = await supabase.getAuthUser(token);
  if (!user?.id) throw new UnauthorizedException('Invalid or expired session');
  return user.id;
}

@ApiTags('referees')
@Controller()
export class QualificationsController {
  constructor(
    private readonly qualifications: QualificationsService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('events/:eventId/referee-qualifications')
  @ApiOperation({ summary: 'List active referee qualifications for an event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async list(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.qualifications.listForEvent(eventId);
  }

  @Get('events/:eventId/persons/:personId/referee-qualifications')
  @ApiOperation({ summary: 'List qualifications for a specific person' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  async listForPerson(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('personId', ParseUUIDPipe) personId: string,
  ) {
    return this.qualifications.listForPerson(eventId, personId);
  }

  @Put('events/:eventId/referee-qualifications')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or update a referee qualification (organizer+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async upsert(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpsertQualificationDto,
  ) {
    return this.qualifications.upsert(eventId, dto.personId, dto.role, dto.rating ?? null);
  }

  @Delete('referee-qualifications/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a qualification (active=false)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    await this.qualifications.deactivate(id);
  }

  // ── Skills catalog ────────────────────────────────────────────────────────────

  @Get('events/:eventId/referee-skills')
  @ApiOperation({ summary: 'List system + event custom skills' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async listSkills(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.qualifications.listEventSkills(eventId);
  }

  @Post('events/:eventId/referee-skills')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a custom skill for this event (organizer+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async createSkill(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateRefereeSkillDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.qualifications.createCustomSkill(eventId, dto, userId);
  }

  @Patch('referee-skills/:skillId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update a skill (organizer+; system skills allow description/sortOrder only)',
  })
  @ApiParam({ name: 'skillId', type: 'string' })
  async updateSkill(
    @Param('skillId') skillId: string,
    @Body() dto: UpdateRefereeSkillDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.qualifications.updateCustomSkill(skillId, dto, userId);
  }

  /** R4: bulk drag-reorder. Re-writes every skill's sort_order. */
  @Patch('events/:eventId/referee-skills/reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Reorder referee skills (organizer+; affects display order in catalog)',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async reorderSkills(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: ReorderRefereeSkillsDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.qualifications.reorderSkills(eventId, dto.orderedSkillIds, userId);
  }

  /** Slice 6: hide / un-hide a skill for this event (works for system skills). */
  @Patch('events/:eventId/referee-skills/:skillId/visibility')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hide or un-hide a skill in this event (organizer+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'skillId', type: 'string' })
  async setSkillVisibility(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('skillId') skillId: string,
    @Body() dto: SetSkillVisibilityDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.qualifications.setSkillVisibility(eventId, skillId, dto.isHidden, userId);
  }

  @Delete('referee-skills/:skillId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a custom skill (organizer+)' })
  @ApiParam({ name: 'skillId', type: 'string' })
  async deleteSkill(@Param('skillId') skillId: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    await this.qualifications.deleteCustomSkill(skillId, userId);
  }

  // ── Task 3: Event referees ────────────────────────────────────────────────────

  @Get('events/:eventId/referees')
  @ApiOperation({ summary: 'List referees for an event with qualifications + assignments' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async listReferees(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    const actorUserId = await getUserId(req, this.supabase);
    return this.qualifications.listEventReferees(eventId, actorUserId);
  }

  /**
   * Post-0063: referee rows key on person_id (= global_persons.id). The
   * legacy /referees/:userId and /referees/by-person/:personId routes are
   * gone; callers pass personId directly.
   */
  @Post('events/:eventId/referees/:personId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Register a person as referee for this event (admin+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  async ensureReferee(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Req() req: FastifyRequest,
  ) {
    const actorUserId = await getUserId(req, this.supabase);
    await this.qualifications.ensureEventReferee(eventId, personId, actorUserId);
  }

  @Patch('events/:eventId/referees/:personId/availability')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Update availability flags for a referee (admin+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  async updateAvailability(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() dto: UpdateRefereeAvailabilityDto,
    @Req() req: FastifyRequest,
  ) {
    const actorUserId = await getUserId(req, this.supabase);
    await this.qualifications.updateAvailability(eventId, personId, dto, actorUserId);
  }

  @Delete('events/:eventId/referees/:personId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unregister a person as referee for this event (admin+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'personId', type: 'string', format: 'uuid' })
  async removeReferee(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Req() req: FastifyRequest,
  ) {
    const actorUserId = await getUserId(req, this.supabase);
    await this.qualifications.removeEventReferee(eventId, personId, actorUserId);
  }
}
