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
import type { MyPhotos } from '@myclash/types';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { getStaffSession } from '../../common/auth/identity';
import { requireRequestUserId } from '../../common/auth/request-user';
import { AllowOnArchivedEvent } from '../../common/event-readonly/allow-on-archived.decorator';
import { SupabaseService } from '../supabase/supabase.service';
import { MyPhotosService } from './my-photos.service';
import { MyPhotoQueryDto } from './photo-public.dto';
import { PhotoUploadService } from './photo-upload.service';

/**
 * A signed-in person's photos of one of her Events, from her personal space (design Goal 11,
 * slice 6a): she sends one without the QR code, under her name, lists hers and deletes hers. Each
 * route needs her login first (401 otherwise); the upload's own door decides "one of her Events".
 */
@ApiTags('me')
@ApiCookieAuth('sb-access-token')
@Controller()
export class MyPhotosController {
  constructor(
    private readonly uploads: PhotoUploadService,
    private readonly myPhotos: MyPhotosService,
    private readonly supabase: SupabaseService,
  ) {}

  /** Placed by its Event: no photo arrives at an archived Event, as on the QR route. */
  @Post('me/events/:eventId/photos')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a photo to one of her own Events, under her name' })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        caption: { type: 'string', maxLength: 200 },
        tournamentId: { type: 'string', format: 'uuid' },
        workshopId: { type: 'string', format: 'uuid' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, description: '{ id, status: waiting | approved }' })
  async upload(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ id: string; status: 'waiting' | 'approved' }> {
    const reader = {
      userId: await requireRequestUserId(req, this.supabase),
      staff: getStaffSession(req),
    };
    return this.uploads.upload(eventId, { kind: 'account', reader }, req);
  }

  @Get('me/events/:eventId/photos')
  @ApiOperation({ summary: 'The photos she sent to this Event from her personal space' })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  async list(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: MyPhotoQueryDto,
    @Req() req: FastifyRequest,
  ): Promise<MyPhotos> {
    const userId = await requireRequestUserId(req, this.supabase);
    return this.myPhotos.list(eventId, userId, query.before);
  }

  /** Open on an archived Event: a person may ask for her photo to go (design, "Constraints"). */
  @Delete('me/events/:eventId/photos/:photoId')
  @AllowOnArchivedEvent()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a photo she sent from her personal space' })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  @ApiParam({ name: 'photoId', format: 'uuid' })
  async remove(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    const userId = await requireRequestUserId(req, this.supabase);
    await this.myPhotos.remove(eventId, photoId, userId);
  }
}
