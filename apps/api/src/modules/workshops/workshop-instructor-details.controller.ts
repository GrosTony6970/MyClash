/**
 * What one Workshop says about one of its instructors, over their profile (rulings 556, 558-560):
 * a bio, a club line and a photo. Written by an organiser for any line (`workshop_lead+`) and by the
 * instructor for their own line, from the personal space.
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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { WORKSHOP_INSTRUCTOR_BIO_MAX, WORKSHOP_INSTRUCTOR_CLUB_MAX } from '@myclash/types';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { requireRequestUserId } from '../../common/auth/request-user';
import { NO_UPLOAD, readUpload } from '../../common/read-upload';
import { SupabaseService } from '../supabase/supabase.service';
import { WorkshopInstructorDetailsService } from './workshop-instructor-details.service';
import { WORKSHOP_INSTRUCTOR_PHOTO_UPLOAD } from './workshop-instructor-photo';

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

  @Post('workshops/:id/instructors/:globalPersonId/details/photo')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({
    summary:
      "Upload this Workshop's photo of one instructor (the instructor, own line; workshop_lead+, any line). The photo it replaces is deleted.",
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'globalPersonId', type: 'string', format: 'uuid' })
  async uploadPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('globalPersonId', ParseUUIDPipe) globalPersonId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await requireRequestUserId(req, this.supabase);
    // Who may write the line is decided before the file is read.
    const lineId = await this.details.writableLine(id, globalPersonId, userId);
    const upload = (await readUpload(req, WORKSHOP_INSTRUCTOR_PHOTO_UPLOAD)) ?? NO_UPLOAD;
    return this.details.uploadPhoto(lineId, upload);
  }

  @Delete('workshops/:id/instructors/:globalPersonId/details/photo')
  @ApiOperation({
    summary:
      "Remove this Workshop's photo of one instructor, so the profile's shows again (the instructor, own line; workshop_lead+, any line). Its file is deleted.",
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'globalPersonId', type: 'string', format: 'uuid' })
  async removePhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('globalPersonId', ParseUUIDPipe) globalPersonId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await requireRequestUserId(req, this.supabase);
    const lineId = await this.details.writableLine(id, globalPersonId, userId);
    return this.details.removePhoto(lineId);
  }
}
