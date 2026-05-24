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
import { SuperAdminGuard } from '../guards/super-admin.guard';
import { CustomRulesetsService } from './custom-rulesets.service';
import {
  CreateCustomRulesetDto,
  PublishRulesetDto,
  RejectSubmissionDto,
  UpdateCustomRulesetDto,
} from './dto/custom-rulesets.dto';

function getActorId(req: FastifyRequest): string {
  return (req as FastifyRequest & { actorUserId?: string }).actorUserId ?? 'unknown';
}

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('admin/custom-rulesets')
export class CustomRulesetsAdminController {
  constructor(private readonly service: CustomRulesetsService) {}

  @Get()
  @ApiOperation({ summary: 'List custom rulesets (super admin)' })
  async list() {
    return this.service.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one custom ruleset (super admin)' })
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create custom ruleset (super admin)' })
  async create(@Body() dto: CreateCustomRulesetDto, @Req() req: FastifyRequest) {
    return this.service.create(dto, getActorId(req));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update custom ruleset (super admin)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomRulesetDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.update(id, dto, getActorId(req));
  }

  @Post(':id/clone')
  @ApiOperation({ summary: 'Clone custom ruleset (super admin)' })
  async clone(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.service.clone(id, getActorId(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete custom ruleset (super admin)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.remove(id, getActorId(req));
  }

  @Post(':id/publish')
  @ApiOperation({
    summary: 'Publish custom ruleset, snapshot the current version, and auto-bump (super admin)',
  })
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishRulesetDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.publish(id, getActorId(req), dto?.nextVersion);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'List published version snapshots (super admin)' })
  async listVersions(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listVersions(id);
  }

  @Post(':id/versions/:versionId/rollback')
  @ApiOperation({
    summary: 'Restore a previous version as the current draft (super admin)',
  })
  async rollback(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.service.rollback(id, versionId, getActorId(req));
  }

  @Post(':id/unpublish')
  @ApiOperation({ summary: 'Unpublish custom ruleset (super admin)' })
  async unpublish(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.service.unpublish(id, getActorId(req));
  }

  @Post(':id/set-default')
  @ApiOperation({ summary: 'Mark this ruleset as the default (super admin)' })
  async setDefault(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.service.setDefault(id, getActorId(req));
  }

  @Post(':id/approve-public')
  @ApiOperation({
    summary: 'Approve an org-submitted scoring ruleset for platform-wide sharing (super admin)',
  })
  async approvePublic(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.service.approveForPublic(id, getActorId(req));
  }

  @Post(':id/reject-submission')
  @ApiOperation({
    summary: 'Reject an org-submitted scoring ruleset (super admin). Reason is shown to the org.',
  })
  async rejectSubmission(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectSubmissionDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.rejectSubmission(id, dto.reason, getActorId(req));
  }
}
