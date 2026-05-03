import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AdminRulesetsService } from './admin-rulesets.service';
import { ListRulesetsQueryDto, RejectRulesetDto } from './dto/admin-rulesets.dto';
import { SuperAdminGuard } from './guards/super-admin.guard';

function getActorId(req: FastifyRequest): string {
  return (req as FastifyRequest & { actorUserId?: string }).actorUserId ?? 'unknown';
}

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('admin/rulesets')
export class RulesetsAdminController {
  constructor(private readonly service: AdminRulesetsService) {}

  @Get()
  @ApiOperation({ summary: 'List ruleset submissions (super admin)' })
  async list(@Query() query: ListRulesetsQueryDto) {
    return this.service.listRulesets(query);
  }

  @Patch(':id/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Approve ruleset submission (super admin)' })
  async approve(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.approveRuleset(id, getActorId(req));
  }

  @Patch(':id/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reject ruleset submission (super admin)' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectRulesetDto,
    @Req() req: FastifyRequest,
  ) {
    await this.service.rejectRuleset(id, dto, getActorId(req));
  }
}
