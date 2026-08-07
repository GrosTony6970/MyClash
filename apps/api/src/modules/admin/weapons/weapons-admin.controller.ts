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
import { CreateWeaponDto, UpdateWeaponDto } from './dto/weapons-admin.dto';
import { WeaponsAdminService } from './weapons-admin.service';
import { getActorId } from '../../../common/auth/actor';

@ApiTags('super-admin')
@ApiBearerAuth()
@Controller('admin/weapons')
export class WeaponsAdminController {
  constructor(private readonly service: WeaponsAdminService) {}

  @Get()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'List all weapon catalog entries with usage counts (super admin)' })
  async list() {
    return this.service.list();
  }

  @Post()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Create a weapon catalog entry (super admin)' })
  async create(@Body() dto: CreateWeaponDto, @Req() req: FastifyRequest) {
    return this.service.create(dto, getActorId(req));
  }

  @Patch(':id')
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Rename or (de)activate a weapon catalog entry (super admin)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWeaponDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.update(id, dto, getActorId(req));
  }

  @Delete(':id')
  @UseGuards(SuperAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Hard-delete a weapon catalog entry — cascades to fighter_weapons (super admin)',
  })
  async delete(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.delete(id, getActorId(req));
  }
}
