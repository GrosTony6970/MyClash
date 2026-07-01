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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AIProvidersService } from './ai-providers.service';
import { CreateAiKeyDto, UpdateAiKeyDto } from './dto/ai-key.dto';

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
    private readonly orgs: OrganizationsService,
  ) {}

  /** GET /api/v1/organizations/:orgId/ai-settings — config (ceiling + flags + hasKey) */
  @Get(':orgId/ai-settings')
  @ApiOperation({ summary: 'Get AI config for org (ceiling + flags)' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async getSettings(@Param('orgId', ParseUUIDPipe) orgId: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    await this.orgs.assertOrgRole(orgId, userId, 'admin');
    return this.service.getProviderConfig(orgId);
  }

  /** GET /api/v1/organizations/:orgId/ai-keys */
  @Get(':orgId/ai-keys')
  @ApiOperation({ summary: 'List org AI keys (masked, with month-to-date spend)' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async listKeys(@Param('orgId', ParseUUIDPipe) orgId: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    await this.orgs.assertOrgRole(orgId, userId, 'admin');
    return this.service.listKeys(orgId);
  }

  /** POST /api/v1/organizations/:orgId/ai-keys */
  @Post(':orgId/ai-keys')
  @ApiOperation({ summary: 'Add an org AI key' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async createKey(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateAiKeyDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.orgs.assertOrgRole(orgId, userId, 'admin');
    return this.service.createKey(orgId, dto, userId);
  }

  /** PATCH /api/v1/organizations/:orgId/ai-keys/:id */
  @Patch(':orgId/ai-keys/:id')
  @ApiOperation({ summary: 'Update an org AI key (key optional — blank keeps current)' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async updateKey(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAiKeyDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.orgs.assertOrgRole(orgId, userId, 'admin');
    return this.service.updateKey(orgId, id, dto);
  }

  /** DELETE /api/v1/organizations/:orgId/ai-keys/:id */
  @Delete(':orgId/ai-keys/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an org AI key' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async deleteKey(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.orgs.assertOrgRole(orgId, userId, 'admin');
    await this.service.deleteKey(orgId, id);
  }

  /** POST /api/v1/organizations/:orgId/ai-keys/:id/activate */
  @Post(':orgId/ai-keys/:id/activate')
  @ApiOperation({ summary: 'Make this key the active org AI key' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async activateKey(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.orgs.assertOrgRole(orgId, userId, 'admin');
    await this.service.activateKey(orgId, id);
    return this.service.listKeys(orgId);
  }
}
