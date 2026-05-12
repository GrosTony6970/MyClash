import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AIDataQualityService } from './ai-data-quality.service';
import { UpdateDataQualityFindingDto } from './dto/data-quality.dto';
import { SuperAdminGuard } from './guards/super-admin.guard';

type ActorRequest = FastifyRequest & { actorUserId?: string };

function getActorId(req: FastifyRequest): string {
  return (req as ActorRequest).actorUserId ?? 'unknown';
}

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('admin/data-quality')
export class AIDataQualityController {
  constructor(private readonly service: AIDataQualityService) {}

  @Post('scans')
  @ApiOperation({ summary: 'Start a super-admin data quality scan' })
  startScan(@Req() req: FastifyRequest) {
    return this.service.startScan(getActorId(req));
  }

  @Get('scans')
  @ApiOperation({ summary: 'List super-admin data quality scans' })
  listScans() {
    return this.service.listScans();
  }

  @Get('findings')
  @ApiOperation({ summary: 'List super-admin data quality findings' })
  listFindings(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('severity') severity?: string,
  ) {
    return this.service.listFindings({ status: status as never, type, severity });
  }

  @Patch('findings/:id')
  @ApiOperation({ summary: 'Update a super-admin data quality finding status' })
  updateFinding(
    @Param('id') id: string,
    @Body() dto: UpdateDataQualityFindingDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.updateFindingStatus(id, dto.status, getActorId(req));
  }
}
