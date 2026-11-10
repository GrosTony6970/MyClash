/**
 * What one Workshop says about one of its instructors, over their profile (rulings 556, 558-560):
 * a bio and a club line. Written by an organiser for any line (`workshop_lead+`) and by the
 * instructor for their own line, from the personal space.
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { WORKSHOP_INSTRUCTOR_BIO_MAX, WORKSHOP_INSTRUCTOR_CLUB_MAX } from '@myclash/types';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { requireRequestUserId } from '../../common/auth/request-user';
import { SupabaseService } from '../supabase/supabase.service';
import { WorkshopInstructorDetailsService } from './workshop-instructor-details.service';

// Each door sends only the boxes it changed (two writers): absent = untouched, blank or null =
// cleared, so the profile shows again.
const instructorDetailsSchema = z
  .object({
    bio: z.string().max(WORKSHOP_INSTRUCTOR_BIO_MAX).nullish(),
    club: z.string().max(WORKSHOP_INSTRUCTOR_CLUB_MAX).nullish(),
  })
  .strict();
class InstructorDetailsBody extends createZodDto(instructorDetailsSchema) {}

@ApiTags('workshops')
@ApiBearerAuth()
@Controller()
export class WorkshopInstructorDetailsController {
  constructor(
    private readonly details: WorkshopInstructorDetailsService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('workshops/:id/instructors/:globalPersonId/details')
  @ApiOperation({
    summary:
      "What this Workshop says about one instructor, and the profile it falls back to (the instructor, own line; workshop_lead+, any line). The profile's bio only when public, or to the person.",
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'globalPersonId', type: 'string', format: 'uuid' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('globalPersonId', ParseUUIDPipe) globalPersonId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await requireRequestUserId(req, this.supabase);
    return this.details.getDetails(id, globalPersonId, userId);
  }

  @Patch('workshops/:id/instructors/:globalPersonId/details')
  @ApiOperation({
    summary:
      "Write this Workshop's bio and club line for one instructor (the instructor, own line; workshop_lead+, any line). A box not sent is kept; a blank one clears it.",
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'globalPersonId', type: 'string', format: 'uuid' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('globalPersonId', ParseUUIDPipe) globalPersonId: string,
    @Body() dto: InstructorDetailsBody,
    @Req() req: FastifyRequest,
  ) {
    const userId = await requireRequestUserId(req, this.supabase);
    return this.details.updateDetails(id, globalPersonId, userId, dto);
  }
}
