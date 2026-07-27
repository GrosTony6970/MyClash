/**
 * exports.controller.ts — T-1004
 *
 * GET /api/v1/events/:eventId/exports/hema-ratings.zip     — HEMA Ratings submission bundle
 * GET /api/v1/events/:eventId/exports/hema-ratings/preview — its pre-flight check
 * GET /api/v1/events/:eventId/exports/full.csv             — all matches + exchanges
 * GET /api/v1/events/:eventId/exports/full.json            — full event JSON
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { ArchiveService } from './archive.service';
import type { ArchiveInclude, RestoreOptions } from './archive.types';
import { ExportsService } from './exports.service';

async function getUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) return 'anonymous';
  const {
    data: { user },
  } = await supabase.anon.auth.getUser(token);
  return user?.id ?? 'anonymous';
}

@ApiTags('exports')
@Controller()
export class ExportsController {
  constructor(
    private readonly exports: ExportsService,
    private readonly supabase: SupabaseService,
    private readonly archives: ArchiveService,
  ) {}

  // ── HEMA Ratings: submission bundle ───────────────────────────────────────

  @Get('events/:eventId/exports/hema-ratings.zip')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'HEMA Ratings submission bundle (fighters + clubs + tournaments)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async hemaRatingsZip(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    // This bundle contains event roster data, so it is organizer-only.
    const userId = await getUserId(req, this.supabase);
    await this.archives.assertEventAdmin(eventId, userId);
    const { filename, buffer } = await this.exports.generateHemaRatingsZip(eventId);
    void reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  }

  @Get('events/:eventId/exports/hema-ratings/preview')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pre-flight check for the HEMA Ratings submission bundle' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async hemaRatingsPreview(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.archives.assertEventAdmin(eventId, userId);
    return this.exports.previewHemaRatingsSubmission(eventId);
  }

  // ── Full CSV export ───────────────────────────────────────────────────────

  @Get('events/:eventId/exports/full.csv')
  @ApiOperation({ summary: 'Full event CSV export (all matches + exchanges)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async fullCsv(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.archives.assertEventAdmin(eventId, userId);
    const csv = await this.exports.generateFullCsv(eventId);
    void reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="exchanges.csv"')
      .send(csv);
  }

  // ── Full JSON export ──────────────────────────────────────────────────────

  @Get('events/:eventId/exports/full.json')
  @ApiOperation({ summary: 'Full event JSON export (round-trippable)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async fullJson(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.archives.assertEventAdmin(eventId, userId);
    const data = await this.exports.generateEventJson(eventId);
    void reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="event.json"')
      .send(JSON.stringify(data, null, 2));
  }

  @Get('events/:eventId/archive')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Organizer event archive export' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'format', enum: ['zip', 'json'], required: false })
  @ApiQuery({ name: 'include', enum: ['structure', 'scoring'], required: false })
  async eventArchive(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('format') format: 'zip' | 'json' = 'zip',
    @Query('include') include: ArchiveInclude = 'scoring',
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const userId = await getUserId(req, this.supabase);
    const archive = await this.archives.generateEventArchive(eventId, userId, {
      include: normalizeInclude(include),
    });
    this.sendArchive(reply, archive.source.eventSlug, normalizeFormat(format), archive);
  }

  @Get('tournaments/:tournamentId/archive')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Organizer tournament archive export' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'format', enum: ['zip', 'json'], required: false })
  @ApiQuery({ name: 'include', enum: ['structure', 'scoring'], required: false })
  async tournamentArchive(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Query('format') format: 'zip' | 'json' = 'zip',
    @Query('include') include: ArchiveInclude = 'scoring',
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const userId = await getUserId(req, this.supabase);
    const archive = await this.archives.generateTournamentArchive(tournamentId, userId, {
      include: normalizeInclude(include),
    });
    this.sendArchive(
      reply,
      archive.source.tournamentSlug ?? archive.source.eventSlug,
      normalizeFormat(format),
      archive,
    );
  }

  @Get('tournaments/:tournamentId/exports/matches.csv')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tournament match report CSV export' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async tournamentMatchesCsv(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const userId = await getUserId(req, this.supabase);
    const reports = await this.archives.generateTournamentCsvReports(tournamentId, userId);
    void reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="matches.csv"')
      .send(reports.matchesCsv);
  }

  @Get('tournaments/:tournamentId/exports/exchanges.csv')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tournament exchange report CSV export' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async tournamentExchangesCsv(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const userId = await getUserId(req, this.supabase);
    const reports = await this.archives.generateTournamentCsvReports(tournamentId, userId);
    void reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="exchanges.csv"')
      .send(reports.exchangesCsv);
  }

  @Get('tournaments/:tournamentId/exports/rankings.csv')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tournament ranking report CSV export' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async tournamentRankingsCsv(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const userId = await getUserId(req, this.supabase);
    const reports = await this.archives.generateTournamentCsvReports(tournamentId, userId);
    void reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="rankings.csv"')
      .send(reports.rankingsCsv);
  }

  @Post('archive/restore-preview')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Validate an organizer archive before restore' })
  async restorePreview(@Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    const buffer = await readUploadedArchive(req);
    return this.archives.previewRestore(buffer, userId);
  }

  @Post('archive/restore')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Restore an organizer archive as a new copy' })
  async restoreArchive(
    @Req() req: FastifyRequest,
    @Body() body: RestoreOptions,
    @Query('targetOrganizationId') targetOrganizationId?: string,
    @Query('targetEventId') targetEventId?: string,
    @Query('confirmation') confirmation?: string,
  ) {
    const userId = await getUserId(req, this.supabase);
    const buffer = await readUploadedArchive(req);
    return this.archives.restoreArchiveCopy(buffer, userId, {
      ...(body ?? {}),
      targetOrganizationId: targetOrganizationId ?? body?.targetOrganizationId,
      targetEventId: targetEventId ?? body?.targetEventId,
      confirmation: confirmation ?? body?.confirmation,
    });
  }

  private sendArchive(
    reply: FastifyReply,
    basename: string,
    format: 'zip' | 'json',
    archive: Awaited<ReturnType<ArchiveService['generateEventArchive']>>,
  ) {
    const safeName = basename.replace(/[^a-zA-Z0-9-]+/g, '-');
    if (format === 'json') {
      void reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${safeName}.archive.json"`)
        .send(this.archives.archiveToJsonBuffer(archive));
      return;
    }
    void reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${safeName}.archive.zip"`)
      .send(this.archives.archiveToZipBuffer(archive));
  }
}

async function readUploadedArchive(req: FastifyRequest): Promise<Buffer> {
  const maybeReq = req as FastifyRequest & {
    file?: () => Promise<{ filename?: string; toBuffer: () => Promise<Buffer> } | undefined>;
  };
  const data = await maybeReq.file?.();
  if (!data) throw new BadRequestException('No archive file uploaded.');
  const filename = data.filename ?? '';
  if (!filename.endsWith('.json') && !filename.endsWith('.zip')) {
    throw new BadRequestException('Archive upload must be a .json or .zip file.');
  }
  return data.toBuffer();
}

function normalizeInclude(value: string): ArchiveInclude {
  if (value === 'structure' || value === 'scoring') return value;
  throw new BadRequestException('include must be structure or scoring.');
}

function normalizeFormat(value: string): 'zip' | 'json' {
  if (value === 'zip' || value === 'json') return value;
  throw new BadRequestException('format must be zip or json.');
}
