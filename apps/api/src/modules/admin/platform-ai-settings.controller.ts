import { Body, Controller, Delete, Get, HttpCode, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SavePlatformAISettingsDto } from './dto/platform-ai-settings.dto';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { PlatformAISettingsService } from './platform-ai-settings.service';

type ActorRequest = FastifyRequest & { actorUserId?: string };

function getActorId(req: FastifyRequest): string {
  return (req as ActorRequest).actorUserId ?? 'unknown';
}

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('admin/ai-settings')
export class PlatformAISettingsController {
  constructor(private readonly settings: PlatformAISettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get shared super-admin AI settings' })
  getSettings() {
    return this.settings.getProviderConfig();
  }

  @Put()
  @ApiOperation({ summary: 'Save shared super-admin AI settings' })
  saveSettings(@Body() dto: SavePlatformAISettingsDto, @Req() req: FastifyRequest) {
    return this.settings.saveKey(dto.provider, dto.apiKey, getActorId(req));
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete shared super-admin AI settings' })
  async deleteSettings() {
    await this.settings.deleteKey();
  }
}
