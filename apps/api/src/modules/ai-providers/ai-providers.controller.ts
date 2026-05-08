import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { AIProvidersService } from './ai-providers.service';
import { SaveAISettingsDto } from './dto/ai-settings.dto';

async function getUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) return 'anonymous';
  const {
    data: { user },
  } = await supabase.anon.auth.getUser(token);
  return user?.id ?? 'anonymous';
}

@ApiTags('ai-providers')
@ApiBearerAuth()
@Controller('organizations')
export class AIProvidersController {
  constructor(
    private readonly service: AIProvidersService,
    private readonly supabase: SupabaseService,
  ) {}

  /** GET /api/v1/organizations/:orgId/ai-settings */
  @Get(':orgId/ai-settings')
  @ApiOperation({ summary: 'Get AI provider config for org' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async getSettings(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.getProviderConfig(orgId);
  }

  /** PUT /api/v1/organizations/:orgId/ai-settings */
  @Put(':orgId/ai-settings')
  @ApiOperation({ summary: 'Save encrypted AI API key for org' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async saveSettings(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: SaveAISettingsDto,
    @Req() req: FastifyRequest,
  ) {
    const _userId = await getUserId(req, this.supabase);
    await this.service.saveKey(orgId, dto.provider, dto.apiKey);
    return this.service.getProviderConfig(orgId);
  }

  /** DELETE /api/v1/organizations/:orgId/ai-settings */
  @Delete(':orgId/ai-settings')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove AI API key for org' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async deleteSettings(@Param('orgId', ParseUUIDPipe) orgId: string, @Req() req: FastifyRequest) {
    const _userId = await getUserId(req, this.supabase);
    await this.service.deleteKey(orgId);
  }
}
