/**
 * spar-flag-admin.controller.ts — FightBook, slice 4: the safety report lists (ruling 692).
 *
 * GET    /organizations/:orgId/fightbook/flags?page= — the club's reports, for the club's admins
 * PUT    /organizations/:orgId/fightbook/flags/:flagId/handled — mark one handled
 * DELETE /organizations/:orgId/fightbook/flags/:flagId/handled — mark it not handled
 * GET    /admin/fightbook/flags?page= — every report, for the platform's super admins
 * PUT|DELETE /admin/fightbook/flags/:flagId/handled — the same mark
 *
 * Who must never read a report is the database function's alone (`fightbook_flag_shown`).
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import type { SparFlagPage } from '@myclash/types';
import { z } from 'zod';
import { getActorId } from '../../common/auth/actor';
import { requireRequestUserId } from '../../common/auth/request-user';
import { PlatformRole } from '../admin/guards/platform-role.decorator';
import { PlatformRoleGuard } from '../admin/guards/platform-role.guard';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { SparFlagAdminService } from './spar-flag-admin.service';

/** A 0-based page of 20 reports; omitted means the first. */
export const flagsQuerySchema = z
  .object({ page: z.coerce.number().int().min(0).max(500).default(0) })
  .strict();
class FlagsQueryDto extends createZodDto(flagsQuerySchema) {}

@ApiTags('fightbook')
@Controller('organizations/:orgId/fightbook/flags')
export class ClubSparFlagsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
    private readonly flags: SparFlagAdminService,
  ) {}

  @Get()
  @ApiOperation({ summary: "The club's safety reports, newest first (club admins)" })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: FlagsQueryDto,
    @Req() req: FastifyRequest,
  ): Promise<SparFlagPage> {
    const userId = await this.admin(orgId, req);
    return this.flags.page(userId, orgId, query.page);
  }

  @Put(':flagId/handled')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark a safety report handled (club admins)' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'flagId', type: 'string', format: 'uuid' })
  async handle(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('flagId', ParseUUIDPipe) flagId: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.flags.mark(await this.admin(orgId, req), orgId, flagId, true);
  }

  @Delete(':flagId/handled')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark a safety report not handled (club admins)' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'flagId', type: 'string', format: 'uuid' })
  async unhandle(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('flagId', ParseUUIDPipe) flagId: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.flags.mark(await this.admin(orgId, req), orgId, flagId, false);
  }

  /** The signed-in caller, as an admin of this club. No platform fallback (ruling 692). */
  private async admin(orgId: string, req: FastifyRequest): Promise<string> {
    const userId = await requireRequestUserId(req, this.supabase);
    await this.orgs.assertOrgRole(orgId, userId, 'admin');
    return userId;
  }
}

/**
 * The platform's list. A bare GET under `PlatformRoleGuard` admits every platform tier, so the
 * read names `super_admin`; the writes default to it.
 */
@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(PlatformRoleGuard)
@Controller('admin/fightbook/flags')
export class PlatformSparFlagsController {
  constructor(private readonly flags: SparFlagAdminService) {}

  @Get()
  @PlatformRole('super_admin')
  @ApiOperation({ summary: 'Every safety report, newest first (super admin)' })
  list(@Query() query: FlagsQueryDto, @Req() req: FastifyRequest): Promise<SparFlagPage> {
    return this.flags.page(getActorId(req), null, query.page);
  }

  @Put(':flagId/handled')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark a safety report handled (super admin)' })
  @ApiParam({ name: 'flagId', type: 'string', format: 'uuid' })
  async handle(
    @Param('flagId', ParseUUIDPipe) flagId: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.flags.mark(getActorId(req), null, flagId, true);
  }

  @Delete(':flagId/handled')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark a safety report not handled (super admin)' })
  @ApiParam({ name: 'flagId', type: 'string', format: 'uuid' })
  async unhandle(
    @Param('flagId', ParseUUIDPipe) flagId: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.flags.mark(getActorId(req), null, flagId, false);
  }
}
