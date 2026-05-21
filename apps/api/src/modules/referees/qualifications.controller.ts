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
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { QualificationsService } from './qualifications.service';

class UpsertQualificationDto {
  @IsUUID()
  personId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  role!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number | null;
}

class CreateRefereeSkillDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsString()
  @MaxLength(32)
  color!: string;
}

class UpdateRefereeSkillDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string;
}

export class UpdateRefereeAvailabilityDto {
  @IsOptional()
  @IsBoolean()
  availableAllTournaments?: boolean;

  @IsOptional()
  @IsBoolean()
  availableAllEventDuration?: boolean;
}

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
  @ApiOperation({ summary: 'Update a custom skill (organizer+)' })
  @ApiParam({ name: 'skillId', type: 'string' })
  async updateSkill(
    @Param('skillId') skillId: string,
    @Body() dto: UpdateRefereeSkillDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.qualifications.updateCustomSkill(skillId, dto, userId);
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

  @Post('events/:eventId/referees/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Register a user as referee for this event (admin+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  async ensureReferee(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: FastifyRequest,
  ) {
    const actorUserId = await getUserId(req, this.supabase);
    await this.qualifications.ensureEventReferee(eventId, userId, actorUserId);
  }

  @Patch('events/:eventId/referees/:userId/availability')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Update availability flags for a referee (admin+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  async updateAvailability(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateRefereeAvailabilityDto,
    @Req() req: FastifyRequest,
  ) {
    const actorUserId = await getUserId(req, this.supabase);
    await this.qualifications.updateAvailability(eventId, userId, dto, actorUserId);
  }
}
