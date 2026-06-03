/**
 * workshops.controller.ts — T-801 + T-802
 *
 * All workshop endpoints from ARCHITECTURE.md §14.
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
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { EnrollmentService } from './enrollment.service';
import {
  type CreateSessionDto,
  type CreateWorkshopDto,
  type UpdateWorkshopDto,
  WorkshopsService,
} from './workshops.service';

// ── DTOs ──────────────────────────────────────────────────────────────────────

class CreateWorkshopBody implements CreateWorkshopDto {
  @IsString() slug!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() level?: string;
  @IsOptional() @IsString() language?: string;
  @IsInt() @Min(1) capacity!: number;
  @IsOptional() @IsString() locationLabel?: string;
}

class UpdateWorkshopBody implements UpdateWorkshopDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() level?: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsString() locationLabel?: string;
}

class CreateSessionBody implements CreateSessionDto {
  @IsISO8601() startTime!: string;
  @IsISO8601() endTime!: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsIn(['scheduled', 'cancelled']) status?: string;
  @IsOptional() @IsUUID() venueId?: string | null;
  @IsOptional() @IsUUID() areaId?: string | null;
}

class AddInstructorBody {
  @IsUUID() personId!: string;
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
  @ApiOperation({ summary: 'List workshops for an event (public)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async list(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.workshops.listWorkshops(eventId);
  }

  @Post('events/:eventId/workshops')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a workshop (organizer+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async create(@Param('eventId', ParseUUIDPipe) eventId: string, @Body() dto: CreateWorkshopBody) {
    return this.workshops.createWorkshop(eventId, dto);
  }

  @Get('workshops/:id')
  @ApiOperation({ summary: 'Get workshop detail (public)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.workshops.getWorkshop(id);
  }

  @Patch('workshops/:id')
  @ApiOperation({ summary: 'Update workshop (organizer+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkshopBody) {
    return this.workshops.updateWorkshop(id, dto);
  }

  // ── Instructors ───────────────────────────────────────────────────────────────

  @Post('workshops/:id/instructors')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add instructor to workshop (organizer+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async addInstructor(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddInstructorBody) {
    return this.workshops.addInstructor(id, dto.personId);
  }

  // ── Sessions ──────────────────────────────────────────────────────────────────

  @Post('workshops/:id/sessions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a workshop session (organizer+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async createSession(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateSessionBody) {
    return this.workshops.createSession(id, dto);
  }

  @Patch('workshop-sessions/:id')
  @ApiOperation({ summary: 'Update a workshop session (organizer+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async updateSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreateSessionBody>,
  ) {
    return this.workshops.updateSession(id, dto);
  }

  @Get('workshop-sessions/:id/roster')
  @ApiOperation({ summary: 'Get session roster (organizer+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getRoster(@Param('id', ParseUUIDPipe) id: string) {
    return this.workshops.getSessionRoster(id);
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
  @ApiOperation({ summary: 'Promote waitlisted person to confirmed (organizer+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  async promote(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    // userId here is personId (named userId in the API spec for consistency)
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
