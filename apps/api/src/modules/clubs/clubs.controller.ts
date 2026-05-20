import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { CATALOG_READ_THROTTLE } from '../../common/throttling/throttle-profiles';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { ClubsService, type DeleteClubMode } from './clubs.service';
import {
  BulkClubIdsDto,
  BulkClubUpdateDto,
  ClubQueryDto,
  ClubReviewRequestQueryDto,
  CreateClubDto,
  LinkClubReviewRequestDto,
  RejectClubReviewRequestDto,
  UpdateClubDto,
} from './dto/clubs.dto';

function getActorId(req: FastifyRequest): string {
  return (req as FastifyRequest & { actorUserId?: string }).actorUserId ?? 'unknown';
}

@ApiTags('clubs')
@Controller('clubs')
export class ClubsController {
  constructor(private readonly clubs: ClubsService) {}

  /** GET /api/v1/clubs?q=...&country=... */
  @Get()
  @Throttle(CATALOG_READ_THROTTLE)
  @ApiOperation({ summary: 'List clubs (public)' })
  async list(@Query() query: ClubQueryDto) {
    return this.clubs.list(query);
  }

  /** GET /api/v1/clubs/review-requests?status=pending */
  @Get('review-requests')
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'List organizer-submitted club review requests' })
  async listReviewRequests(@Query() query: ClubReviewRequestQueryDto) {
    return this.clubs.listReviewRequests(query.status ?? 'pending');
  }

  /** POST /api/v1/clubs/review-requests/:id/approve */
  @Post('review-requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Approve a proposed club as verified' })
  async approveReviewRequest(@Param('id', ParseUUIDPipe) id: string) {
    return this.clubs.approveReviewRequest(id);
  }

  /** POST /api/v1/clubs/review-requests/:id/link */
  @Post('review-requests/:id/link')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Link a proposed club request to an existing club' })
  async linkReviewRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkClubReviewRequestDto,
  ) {
    return this.clubs.linkReviewRequest(id, dto.existingClubId, dto.notes);
  }

  /** POST /api/v1/clubs/review-requests/:id/reject */
  @Post('review-requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Reject a proposed club review request' })
  async rejectReviewRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectClubReviewRequestDto,
  ) {
    return this.clubs.rejectReviewRequest(id, dto.notes);
  }

  // ── Bulk admin endpoints ──────────────────────────────────────────────
  // Registered BEFORE the catch-all `GET /:slug` and `PATCH /:id` so the
  // literal path segments ("bulk-verify" etc.) match before the param routes.

  /** POST /api/v1/clubs/bulk-verify */
  @Post('bulk-verify')
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Mark a batch of clubs as verified (super admin)' })
  async bulkVerify(@Body() dto: BulkClubIdsDto, @Req() req: FastifyRequest) {
    return this.clubs.bulkSetVerified(dto.ids, true, getActorId(req));
  }

  /** POST /api/v1/clubs/bulk-unverify */
  @Post('bulk-unverify')
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Mark a batch of clubs as unverified (super admin)' })
  async bulkUnverify(@Body() dto: BulkClubIdsDto, @Req() req: FastifyRequest) {
    return this.clubs.bulkSetVerified(dto.ids, false, getActorId(req));
  }

  /** POST /api/v1/clubs/bulk-archive */
  @Post('bulk-archive')
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Archive a batch of clubs (super admin)' })
  async bulkArchive(@Body() dto: BulkClubIdsDto, @Req() req: FastifyRequest) {
    return this.clubs.bulkArchive(dto.ids, getActorId(req));
  }

  /** POST /api/v1/clubs/bulk-delete */
  @Post('bulk-delete')
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({
    summary: 'Safe-delete a batch of clubs; referenced rows surface as per-row errors',
  })
  async bulkDelete(@Body() dto: BulkClubIdsDto, @Req() req: FastifyRequest) {
    return this.clubs.bulkSafeDelete(dto.ids, getActorId(req));
  }

  /** POST /api/v1/clubs/bulk-cleanup-delete */
  @Post('bulk-cleanup-delete')
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({
    summary: 'Cleanup-delete a batch of clubs (clears supported references first; super admin)',
  })
  async bulkCleanupDelete(@Body() dto: BulkClubIdsDto, @Req() req: FastifyRequest) {
    return this.clubs.bulkCleanupDelete(dto.ids, getActorId(req));
  }

  /** POST /api/v1/clubs/bulk-update */
  @Post('bulk-update')
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({
    summary: 'Apply city / countryCode across a batch of clubs (super admin)',
  })
  async bulkUpdate(@Body() dto: BulkClubUpdateDto, @Req() req: FastifyRequest) {
    return this.clubs.bulkUpdate(dto.ids, dto, getActorId(req));
  }

  /** GET /api/v1/clubs/:slug */
  @Get(':slug')
  @ApiOperation({ summary: 'Get club by slug (public)' })
  async getBySlug(@Param('slug') slug: string) {
    return this.clubs.getBySlug(slug);
  }

  /** POST /api/v1/clubs */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a club (organizer+)' })
  async create(@Body() dto: CreateClubDto) {
    return this.clubs.create(dto);
  }

  /** PATCH /api/v1/clubs/:id/verify */
  @Patch(':id/verify')
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Mark a club as verified (super admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async verify(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.clubs.setVerified(id, true, getActorId(req));
  }

  /** PATCH /api/v1/clubs/:id/unverify */
  @Patch(':id/unverify')
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Mark a club as unverified (super admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async unverify(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.clubs.setVerified(id, false, getActorId(req));
  }

  /** PATCH /api/v1/clubs/:id */
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a club (organizer+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClubDto) {
    return this.clubs.update(id, dto);
  }

  /** POST /api/v1/clubs/:id/logo */
  @Post(':id/logo')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Upload a club logo (super admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async uploadLogo(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const data = await (
      req as FastifyRequest & {
        file: () => Promise<
          | {
              filename: string;
              mimetype: string;
              toBuffer: () => Promise<Buffer>;
            }
          | undefined
        >;
      }
    ).file();
    const buffer = data ? await data.toBuffer() : Buffer.alloc(0);
    return this.clubs.uploadLogo(id, {
      buffer,
      filename: data?.filename ?? '',
      mimetype: data?.mimetype ?? '',
    });
  }

  /** DELETE /api/v1/clubs/:id/logo */
  @Delete(':id/logo')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Remove a club logo (super admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async deleteLogo(@Param('id', ParseUUIDPipe) id: string) {
    return this.clubs.deleteLogo(id);
  }

  /** DELETE /api/v1/clubs/:id?mode=safe|archive|cleanup */
  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Delete or archive a club (super admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('mode', new DefaultValuePipe('safe')) mode: DeleteClubMode,
  ) {
    return this.clubs.deleteClub(id, mode);
  }
}
