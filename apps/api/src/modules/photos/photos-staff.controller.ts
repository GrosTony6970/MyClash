import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { PhotoQueuePage, PhotoSummary } from '@myclash/types';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { PhotoModerationService } from './photo-moderation.service';
import { PhotoQueueQueryDto } from './photo-queue.dto';

/**
 * The photo queue for a staff login with the `photos` job (design, "Moderation"): the organiser's
 * queue calls (not the QR link), on the login's own Event. The address names no Event: the staff
 * session does. Open on a
 * completed Event, refused once it is archived (rulings 437, 438): the archived-Event lock cannot
 * place these routes, so `archived-lock-ledger.ts` files them under the staff session's check.
 */
@ApiTags('photos')
@Controller('staff/photos')
export class PhotosStaffController {
  constructor(private readonly moderation: PhotoModerationService) {}

  @Get('summary')
  @ApiOperation({ summary: "The login's Event: its waiting count and clock (photos staff)" })
  async summary(@Req() req: FastifyRequest): Promise<PhotoSummary> {
    return this.moderation.summary(await this.moderation.eventForStaff(req));
  }

  @Get()
  @ApiOperation({ summary: 'One page of the photo moderation queue, newest first (photos staff)' })
  async queue(
    @Query() query: PhotoQueueQueryDto,
    @Req() req: FastifyRequest,
  ): Promise<PhotoQueuePage> {
    const event = await this.moderation.eventForStaff(req);
    return this.moderation.list(event, query.filter, query.before);
  }

  @Post(':photoId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a photo: the public sees it (photos staff)' })
  @ApiParam({ name: 'photoId', format: 'uuid' })
  async approve(
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ id: string; status: 'approved' }> {
    return this.moderation.approve(await this.moderation.eventForStaff(req), photoId);
  }

  @Post(':photoId/keep')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Keep a reported photo: clear its reports (photos staff)' })
  @ApiParam({ name: 'photoId', format: 'uuid' })
  async keep(
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ id: string; kept: true }> {
    return this.moderation.keep(await this.moderation.eventForStaff(req), photoId);
  }

  @Delete(':photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a photo and its images (photos staff)' })
  @ApiParam({ name: 'photoId', format: 'uuid' })
  async remove(
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.moderation.remove(await this.moderation.eventForStaff(req), photoId);
  }
}
