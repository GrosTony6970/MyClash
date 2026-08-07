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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { PlatformRoleGuard } from '../guards/platform-role.guard';
import { PlatformRole } from '../guards/platform-role.decorator';
import {
  CreateLeagueScoringSystemDto,
  UpdateLeagueScoringSystemDto,
} from './dto/league-scoring-systems.dto';
import { LeagueScoringSystemsService } from './league-scoring-systems.service';
import { getActorId } from '../../../common/auth/actor';

@ApiTags('super-admin')
@ApiBearerAuth()
@Controller('admin/league-scoring-systems')
export class LeagueScoringSystemsController {
  constructor(private readonly service: LeagueScoringSystemsService) {}

  // List endpoint is intentionally NOT guarded by PlatformRoleGuard so that
  // the league editor (used by org/league admins, not only super admins)
  // can populate the scoring-system dropdown. Writes remain super-admin only.
  @Get()
  @ApiOperation({ summary: 'List league scoring systems' })
  async list() {
    return this.service.list();
  }

  @Post()
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('platform_admin')
  @ApiOperation({ summary: 'Create a league scoring system preset (super admin)' })
  async create(@Body() dto: CreateLeagueScoringSystemDto, @Req() req: FastifyRequest) {
    return this.service.create(dto, getActorId(req));
  }

  @Patch(':id')
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('platform_admin')
  @ApiOperation({ summary: 'Update a league scoring system preset (super admin)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeagueScoringSystemDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.update(id, dto, getActorId(req));
  }

  @Delete(':id')
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('platform_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a league scoring system preset (super admin)' })
  async delete(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.delete(id, getActorId(req));
  }

  @Post(':id/clone')
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('platform_admin')
  @ApiOperation({ summary: 'Clone a league scoring system preset (super admin)' })
  async clone(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.service.clone(id, getActorId(req));
  }

  @Patch(':id/set-default')
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('platform_admin')
  @ApiOperation({
    summary:
      'Mark a league scoring system as the catalogue default (auto-clears the prior default).',
  })
  async setDefault(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.service.setDefault(id, getActorId(req));
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'List version history for a scoring system' })
  async listVersions(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listVersions(id);
  }

  @Post(':id/versions/:versionId/rollback')
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('platform_admin')
  @ApiOperation({ summary: 'Rollback to a prior version (super admin)' })
  async rollback(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.service.rollback(id, versionId, getActorId(req));
  }
}
