import {
  Body,
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
import {
  csvFormatFromParam,
  type PhotoLink,
  type PhotoQueuePage,
  type PhotoSummary,
  type PublicPhotoPage,
} from '@myclash/types';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { publicReader } from '../../common/auth/competition-visibility';
import { Public } from '../../common/auth/public.decorator';
import { requireRequestUserId } from '../../common/auth/request-user';
import { AllowOnArchivedEvent } from '../../common/event-readonly/allow-on-archived.decorator';
import { PUBLIC_LIVE_READ_THROTTLE } from '../../common/throttling/throttle-profiles';
import { buildSessionCookieOptions } from '../../security/http-security';
import { SupabaseService } from '../supabase/supabase.service';
import { PHOTO_DEVICE_COOKIE, PhotoDeviceService } from './photo-device';
import { PhotoLinkService } from './photo-link.service';
import { PhotoModerationService } from './photo-moderation.service';
import type { PhotoEventRow } from './photo-organiser';
import { PhotoReportBodyDto, PublicPhotoQueryDto } from './photo-public.dto';
import { PhotoPublicService } from './photo-public.service';
import { PhotoDownloadService } from './photo-download.service';
import { PhotoDownloadQueryDto, PhotoKeepBodyDto, PhotoQueueQueryDto } from './photo-queue.dto';
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
    private readonly publicPhotos: PhotoPublicService,
    private readonly downloads: PhotoDownloadService,
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
    // Anonymous even when she is signed in (design Goal 11): the session is never read here.
    const sender = {
      kind: 'phone' as const,
      token: req.headers['x-photo-token'],
      deviceId: this.deviceFor(req, reply),
    };
    return this.uploads.upload(eventId, sender, req);
  }

  /** The Event's approved photos, newest first, for whoever may see the Event (design, "The public"). */
  @Public()
  @Get('events/:eventId/photos/public')
  @Throttle(PUBLIC_LIVE_READ_THROTTLE)
  @ApiOperation({ summary: "One page of an Event's approved photos, newest first (public)" })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  async publicList(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: PublicPhotoQueryDto,
    @Req() req: FastifyRequest,
  ): Promise<PublicPhotoPage> {
    return this.publicPhotos.feed(eventId, publicReader(req), query);
  }

  /**
   * A phone's Report of a public photo: no account, counted once per phone (ruling 428). Open on
   * an archived Event (ruling 447): its photos stay public until the deletion date.
   */
  @Public()
  @Post('events/:eventId/photos/:photoId/report')
  @AllowOnArchivedEvent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Report a public photo to the moderators (anonymous)' })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  @ApiParam({ name: 'photoId', format: 'uuid' })
  async report(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Body() body: PhotoReportBodyDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ reported: true }> {
    const deviceId = this.deviceFor(req, reply);
    // The pipe trimmed it: a comment of spaces is none (ruling 452).
    const comment = body.comment || null;
    return this.publicPhotos.report(eventId, photoId, deviceId, publicReader(req), comment);
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

  /**
   * Every stored original of the Event (or of one Tournament or Workshop) as one zip, with
   * `photos.csv`, streamed (design Goal 10). Organisers only; a GET, so open on an archived
   * Event until the deletion instant.
   *
   * Fastify answers HEAD through this handler too, and throws a streamed body away by reading it
   * to the end, nothing able to stop it: a HEAD (a download manager's, a scanner's) would read
   * every photo from the bucket. It gets the headers alone, and no zip is made.
   */
  @Get('events/:eventId/photos/download')
  @ApiCookieAuth('sb-access-token')
  @ApiOperation({ summary: "All of an Event's photos as one zip, with photos.csv (organisers)" })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  @ApiProduces('application/zip')
  async download(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: PhotoDownloadQueryDto,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const event = await this.organisersEvent(eventId, req);
    reply.header('Content-Type', 'application/zip').header('Cache-Control', 'no-store');
    if (req.method === 'HEAD') {
      await reply.send();
      return;
    }
    const filter = { tournamentId: query.tournamentId, workshopId: query.workshopId };
    const zip = await this.downloads.zip(event, filter, csvFormatFromParam(query.csv));
    await reply
      .header('Content-Disposition', `attachment; filename="${zip.filename}"`)
      .send(zip.body);
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

  /**
   * Clears the photo's reports up to the newest the screen showed (457); the photo stays. Open on
   * an archived Event, as Delete (ruling 447).
   */
  @Post('events/:eventId/photos/:photoId/keep')
  @AllowOnArchivedEvent()
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('sb-access-token')
  @ApiOperation({
    summary: 'Keep a reported photo: clear its reports up to the newest shown (organisers)',
  })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  @ApiParam({ name: 'photoId', format: 'uuid' })
  async keep(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Body() body: PhotoKeepBodyDto,
    @Req() req: FastifyRequest,
  ): Promise<{ id: string; kept: true }> {
    const event = await this.organisersEvent(eventId, req);
    return this.moderation.keep(event, photoId, body.reportsUpTo);
  }

  /** The signed-in caller, as an admin of the Event's club: the gate of the organiser's calls above. */
  private async organisersEvent(eventId: string, req: FastifyRequest): Promise<PhotoEventRow> {
    const userId = await requireRequestUserId(req, this.supabase);
    return this.moderation.eventForOrganiser(eventId, userId);
  }

  /**
   * The phone, from its signed cookie; a phone with none (or a forged one) gets a new id and its
   * cookie. The upload's per-phone limit and the Report's both count by it.
   */
  private deviceFor(req: FastifyRequest, reply: FastifyReply): string {
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
    return deviceId;
  }
}
