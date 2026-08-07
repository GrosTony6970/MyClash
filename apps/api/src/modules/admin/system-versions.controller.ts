import { BadRequestException, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { SystemVersionsResponseDto } from './dto/system-versions.dto';
import { SuperAdminGuard } from './guards/super-admin.guard';
import {
  AdminSystemActionsService,
  type ComponentAction,
  type ComponentActionResult,
} from './system-actions.service';
import { AdminSystemVersionsService } from './system-versions.service';
import { getActorId } from '../../common/auth/actor';

const VALID_ACTIONS: ReadonlySet<ComponentAction> = new Set(['start', 'stop', 'restart']);

@ApiTags('admin')
@ApiCookieAuth('sb-access-token')
@UseGuards(SuperAdminGuard)
@Controller('admin/system-versions')
export class SystemVersionsAdminController {
  constructor(
    private readonly systemVersions: AdminSystemVersionsService,
    private readonly systemActions: AdminSystemActionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get platform component versions' })
  getSystemVersions(): Promise<SystemVersionsResponseDto> {
    return this.systemVersions.getSystemVersions();
  }

  @Post('components/:key/:action')
  @ApiOperation({ summary: 'Start / stop / restart a platform container' })
  async runComponentAction(
    @Param('key') componentKey: string,
    @Param('action') action: string,
    @Req() req: FastifyRequest,
  ): Promise<ComponentActionResult> {
    if (!VALID_ACTIONS.has(action as ComponentAction)) {
      throw new BadRequestException('Invalid component action.');
    }
    return this.systemActions.runComponentAction(
      componentKey,
      action as ComponentAction,
      getActorId(req),
    );
  }
}
