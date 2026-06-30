/**
 * directory-groups.controller.ts
 *
 * GET    /me/groups                          — list my groups (members + stats)
 * POST   /me/groups                          — create a group
 * PATCH  /me/groups/:groupId                 — rename / reorder a group
 * DELETE /me/groups/:groupId                 — delete a group
 * POST   /me/groups/:groupId/members         — add a global person (idempotent)
 * DELETE /me/groups/:groupId/members/:gpId   — remove a member
 *
 * Claimed-user only (a logged-in bookmark surface); identity resolves from the
 * Supabase JWT (Bearer or sb-access-token cookie).
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
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { DirectoryGroupsService } from './directory-groups.service';
import { AddMemberDto, CreateGroupDto, UpdateGroupDto } from './dto/directory-groups.dto';

@ApiTags('directory-groups')
@Controller()
export class DirectoryGroupsController {
  constructor(
    private readonly groups: DirectoryGroupsService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('me/groups')
  @ApiOperation({ summary: 'List my directory groups with members + stats' })
  async list(@Req() req: FastifyRequest) {
    const userId = await this.resolveUserId(req);
    return this.groups.listGroups(userId);
  }

  @Post('me/groups')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a directory group' })
  async create(@Body() dto: CreateGroupDto, @Req() req: FastifyRequest) {
    const userId = await this.resolveUserId(req);
    return this.groups.createGroup(userId, dto.name);
  }

  @Patch('me/groups/:groupId')
  @ApiOperation({ summary: 'Rename or reorder a directory group' })
  @ApiParam({ name: 'groupId', type: 'string', format: 'uuid' })
  async update(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: UpdateGroupDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await this.resolveUserId(req);
    return this.groups.renameGroup(userId, groupId, {
      name: dto.name,
      sortOrder: dto.sortOrder,
    });
  }

  @Delete('me/groups/:groupId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a directory group' })
  @ApiParam({ name: 'groupId', type: 'string', format: 'uuid' })
  async remove(@Param('groupId', ParseUUIDPipe) groupId: string, @Req() req: FastifyRequest) {
    const userId = await this.resolveUserId(req);
    await this.groups.deleteGroup(userId, groupId);
  }

  @Post('me/groups/:groupId/members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a global person to a group (idempotent)' })
  @ApiParam({ name: 'groupId', type: 'string', format: 'uuid' })
  async addMember(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: AddMemberDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await this.resolveUserId(req);
    return this.groups.addMember(userId, groupId, {
      globalPersonId: dto.globalPersonId,
      slug: dto.slug,
    });
  }

  @Delete('me/groups/:groupId/members/:globalPersonId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member from a group' })
  @ApiParam({ name: 'groupId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'globalPersonId', type: 'string', format: 'uuid' })
  async removeMember(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('globalPersonId', ParseUUIDPipe) globalPersonId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await this.resolveUserId(req);
    await this.groups.removeMember(userId, groupId, globalPersonId);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async resolveUserId(req: FastifyRequest): Promise<string> {
    const authHeader = req.headers['authorization'];
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : cookies?.['sb-access-token'];

    if (!token) throw new UnauthorizedException('Authentication required');
    const user = await this.supabase.getAuthUser(token);
    if (!user) throw new UnauthorizedException('Invalid token');
    return user.id;
  }
}
