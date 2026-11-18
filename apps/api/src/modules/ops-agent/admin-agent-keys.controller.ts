import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { getActorId } from '../../common/auth/actor';
import { PlatformRole } from '../admin/guards/platform-role.decorator';
import { PlatformRoleGuard } from '../admin/guards/platform-role.guard';
import { AgentKeysService, type AgentKeyRow } from './agent-keys.service';

/**
 * The console's off switch for the ops agent (the ops agent's design, operator guide G8). Both
 * routes are super admin only: the list is credential metadata, and a revoke turns the agent off.
 */
@ApiTags('admin')
@ApiCookieAuth('sb-access-token')
@UseGuards(PlatformRoleGuard)
@Controller('admin/agent-keys')
export class AdminAgentKeysController {
  constructor(private readonly keys: AgentKeysService) {}

  @Get()
  @PlatformRole('super_admin')
  @ApiOperation({ summary: "List the ops agent's keys: label and dates, never the key" })
  list(): Promise<AgentKeyRow[]> {
    return this.keys.list();
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an ops agent key at once; a revoked key never comes back' })
  revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: FastifyRequest,
  ): Promise<AgentKeyRow> {
    return this.keys.revoke(id, getActorId(req));
  }
}
