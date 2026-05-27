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
import {
  CreateLeagueScoringSystemDto,
  UpdateLeagueScoringSystemDto,
} from './dto/league-scoring-systems.dto';
import { LeagueScoringSystemsService } from './league-scoring-systems.service';

function getActorId(req: FastifyRequest): string {
  return (req as FastifyRequest & { actorUserId?: string }).actorUserId ?? 'unknown';
}

@ApiTags('super-admin')
@ApiBearerAuth()
@Controller('admin/league-scoring-systems')
export class LeagueScoringSystemsController {
  constructor(private readonly service: LeagueScoringSystemsService) {}

  // List endpoint is intentionally NOT guarded by SuperAdminGuard so that
  // the league editor (used by org/league admins, not only super admins)
  // can populate the scoring-system dropdown. Writes remain super-admin only.
  @Get()
  @ApiOperation({ summary: 'List non-archived league scoring systems' })
  async list() {
    return this.service.list();
  }

  @Post()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Create a league scoring system preset (super admin)' })
  async create(@Body() dto: CreateLeagueScoringSystemDto, @Req() req: FastifyRequest) {
    return this.service.create(dto, getActorId(req));
  }

  @Patch(':id')
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Update a league scoring system preset (super admin)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeagueScoringSystemDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.update(id, dto, getActorId(req));
  }

  @Delete(':id')
  @UseGuards(SuperAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive a league scoring system preset (super admin)' })
  async archive(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.archive(id, getActorId(req));
  }
}
