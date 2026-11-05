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
  Res,
} from '@nestjs/common';
import type { PhotoLink, PhotoQueuePage, PhotoSummary } from '@myclash/types';
import { ConfigService } from '@nestjs/config';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../common/auth/public.decorator';
import { requireRequestUserId } from '../../common/auth/request-user';
import { AllowOnArchivedEvent } from '../../common/event-readonly/allow-on-archived.decorator';
import { buildSessionCookieOptions } from '../../security/http-security';
import { SupabaseService } from '../supabase/supabase.service';
import { PHOTO_DEVICE_COOKIE, PhotoDeviceService } from './photo-device';
import { PhotoLinkService } from './photo-link.service';
import { PhotoModerationService } from './photo-moderation.service';
import type { PhotoEventRow } from './photo-organiser';
import { PhotoQueueQueryDto } from './photo-queue.dto';
import { PhotoUploadService } from './photo-upload.service';

type CookieReply = FastifyReply & {
  setCookie: (name: string, value: string, options: Record<string, unknown>) => void;
};

@ApiTags('photos')
@Controller()
export class PhotosController {
  constructor(
    private readonly uploads: PhotoUploadService,
    private readonly devices: PhotoDeviceService,
    private readonly links: PhotoLinkService,
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly moderation: PhotoModerationService,
  ) {}

  /**
   * A photo from the Event's QR link: no account, the link's token in a header (never the URL,
   * which reaches the access log). Public by operator ruling Q1, 2026-11-04.
   */
  @Public()
  @Post('events/:eventId/photos')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a photo to an Event from its QR link (anonymous)' })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  @ApiHeader({
    name: 'x-photo-token',
    description: 'The token of the Event QR link',
    required: true,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: 40 },
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
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ id: string; status: 'waiting' | 'approved' }> {
    const cookie = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies?.[
      PHOTO_DEVICE_COOKIE
    ];
    const { deviceId, fresh } = this.devices.deviceOf(cookie);
    if (fresh) {
      const { token, expires } = this.devices.sign(deviceId);
      (reply as CookieReply).setCookie(
        PHOTO_DEVICE_COOKIE,
        token,
        buildSessionCookieOptions({ env: this.config.get<string>('NODE_ENV'), expires }),
      );
    }
    return this.uploads.upload(eventId, req.headers['x-photo-token'], deviceId, req);
  }

  @Get('events/:eventId/photos/link')
  @ApiCookieAuth('sb-access-token')
  @ApiOperation({ summary: "The Event's photo QR link token (organisers)" })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  async readLink(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ): Promise<PhotoLink> {
    return this.links.read(eventId, await requireRequestUserId(req, this.supabase));
  }

  @Post('events/:eventId/photos/link/rotate')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('sb-access-token')
  @ApiOperation({ summary: 'Retire the photo QR link and issue a new one (organisers)' })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  async rotateLink(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ): Promise<PhotoLink> {
    return this.links.rotate(eventId, await requireRequestUserId(req, this.supabase));
  }

  @Get('events/:eventId/photos/summary')
  @ApiCookieAuth('sb-access-token')
  @ApiOperation({ summary: "The Event's photo mode, caps and deletion date (organisers)" })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  async summary(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ): Promise<PhotoSummary> {
    return this.moderation.summary(await this.organisersEvent(eventId, req));
  }

  @Get('events/:eventId/photos')
  @ApiCookieAuth('sb-access-token')
  @ApiOperation({ summary: 'One page of the photo moderation queue, newest first (organisers)' })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  async queue(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: PhotoQueueQueryDto,
    @Req() req: FastifyRequest,
  ): Promise<PhotoQueuePage> {
    const event = await this.organisersEvent(eventId, req);
    return this.moderation.list(event, query.filter, query.before);
  }

  /** Open on an archived Event (ruling 443): a photo still waiting at archive can still be shown. */
  @Post('events/:eventId/photos/:photoId/approve')
  @AllowOnArchivedEvent()
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('sb-access-token')
  @ApiOperation({ summary: 'Approve a photo: the public sees it (organisers)' })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  @ApiParam({ name: 'photoId', format: 'uuid' })
  async approve(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ id: string; status: 'approved' }> {
    return this.moderation.approve(await this.organisersEvent(eventId, req), photoId);
  }

  /** Open on an archived Event: a person in a photo may ask for it to go (design, privacy). */
  @Delete('events/:eventId/photos/:photoId')
  @AllowOnArchivedEvent()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth('sb-access-token')
  @ApiOperation({ summary: 'Delete a photo and its images (organisers)' })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  @ApiParam({ name: 'photoId', format: 'uuid' })
  async remove(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.moderation.remove(await this.organisersEvent(eventId, req), photoId);
  }

  /** The signed-in caller, as an admin of the Event's club: the gate of the four calls above. */
  private async organisersEvent(eventId: string, req: FastifyRequest): Promise<PhotoEventRow> {
    const userId = await requireRequestUserId(req, this.supabase);
    return this.moderation.eventForOrganiser(eventId, userId);
  }
}
