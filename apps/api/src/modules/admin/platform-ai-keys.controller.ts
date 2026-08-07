import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CreateAiKeyDto, UpdateAiKeyDto } from '../ai-providers/dto/ai-key.dto';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { PlatformRole } from './guards/platform-role.decorator';
import { ModelSyncService } from './model-sync.service';
import { PlatformAISettingsService } from './platform-ai-settings.service';
import { getActorId } from '../../common/auth/actor';

/** Multi-key management for the shared super-admin AI keys. */
@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(PlatformRoleGuard)
@PlatformRole('super_admin')
@Controller('admin/ai-keys')
export class PlatformAIKeysController {
  constructor(
    private readonly settings: PlatformAISettingsService,
    private readonly modelSync: ModelSyncService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List super-admin AI keys (masked, with month-to-date spend)' })
  list() {
    return this.settings.listKeys();
  }

  @Post()
  @ApiOperation({ summary: 'Add a super-admin AI key' })
  create(@Body() dto: CreateAiKeyDto, @Req() req: FastifyRequest) {
    return this.settings.createKey(dto, getActorId(req));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a super-admin AI key (key optional — blank keeps current)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAiKeyDto) {
    return this.settings.updateKey(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a super-admin AI key' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.settings.deleteKey(id);
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Make this key the active super-admin AI key' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async activate(@Param('id', ParseUUIDPipe) id: string) {
    await this.settings.activateKey(id);
    return this.settings.listKeys();
  }

  @Post(':id/model-sync')
  @HttpCode(200)
  @ApiOperation({ summary: "Diff the registry against this key's provider live models" })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  modelSyncForKey(@Param('id', ParseUUIDPipe) id: string) {
    return this.modelSync.diff({ keyId: id });
  }
}
