import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AIProvidersService } from '../ai-providers/ai-providers.service';
import { CreateAiKeyDto, UpdateAiKeyDto } from '../ai-providers/dto/ai-key.dto';
import { SupabaseService } from '../supabase/supabase.service';
import { GeneratedContentService } from './generated-content.service';

const INSIGHT = 'fighter_insight';

async function getClaimedUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) throw new UnauthorizedException('Authentication required');
  const {
    data: { user },
    error,
  } = await supabase.anon.auth.getUser(token);
  if (error || !user) throw new UnauthorizedException('Invalid token');
  return user.id;
}

function normLocale(locale: string | undefined): string {
  return locale === 'fr' ? 'fr' : 'en';
}

/** Personal-space AI: the fighter's own BYOK key + their performance insight. */
@ApiTags('me-ai')
@ApiBearerAuth()
@Controller('me')
export class MeAIController {
  constructor(
    private readonly providers: AIProvidersService,
    private readonly content: GeneratedContentService,
    private readonly supabase: SupabaseService,
  ) {}

  // ── BYOK keys (multi-key) ───────────────────────────────────────────────────

  @Get('ai-keys')
  @ApiOperation({ summary: "List the fighter's own AI keys (masked, with spend)" })
  async listKeys(@Req() req: FastifyRequest) {
    const gpid = await this.resolveGlobalPersonId(req);
    return gpid ? this.providers.listFighterKeys(gpid) : [];
  }

  @Post('ai-keys')
  @ApiOperation({ summary: "Add one of the fighter's own AI keys" })
  async createKey(@Body() dto: CreateAiKeyDto, @Req() req: FastifyRequest) {
    const gpid = await this.requireGlobalPersonId(req);
    return this.providers.createFighterKey(gpid, dto);
  }

  @Patch('ai-keys/:id')
  @ApiOperation({ summary: "Update one of the fighter's AI keys (key optional)" })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async updateKey(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAiKeyDto,
    @Req() req: FastifyRequest,
  ) {
    const gpid = await this.requireGlobalPersonId(req);
    return this.providers.updateFighterKey(gpid, id, dto);
  }

  @Delete('ai-keys/:id')
  @HttpCode(204)
  @ApiOperation({ summary: "Remove one of the fighter's AI keys" })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async deleteKey(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const gpid = await this.requireGlobalPersonId(req);
    await this.providers.deleteFighterKey(gpid, id);
  }

  @Post('ai-keys/:id/activate')
  @ApiOperation({ summary: "Make this key the fighter's active AI key" })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async activateKey(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const gpid = await this.requireGlobalPersonId(req);
    await this.providers.activateFighterKey(gpid, id);
    return this.providers.listFighterKeys(gpid);
  }

  // ── Insight (resolves the caller's identity → fighter_insight entity) ──────

  @Get('insight')
  @ApiOperation({ summary: "Get the caller's cached performance insight" })
  async getInsight(@Req() req: FastifyRequest, @Query('locale') locale?: string) {
    const userId = await getClaimedUserId(req, this.supabase);
    const gpid = await this.gpidForUser(userId);
    if (!gpid) return null;
    return this.content.get(INSIGHT, gpid, normLocale(locale), userId);
  }

  @Post('insight/generate')
  @ApiOperation({ summary: 'Generate/regenerate the caller performance insight (own key)' })
  async generateInsight(@Req() req: FastifyRequest, @Query('locale') locale?: string) {
    const userId = await getClaimedUserId(req, this.supabase);
    const gpid = await this.requireGpidForUser(userId);
    return this.content.generate(INSIGHT, gpid, normLocale(locale), userId);
  }

  @Post('insight/publish')
  @ApiOperation({ summary: 'Show the insight on the public profile' })
  async publishInsight(@Req() req: FastifyRequest, @Query('locale') locale?: string) {
    const userId = await getClaimedUserId(req, this.supabase);
    const gpid = await this.requireGpidForUser(userId);
    return this.content.setPublished(INSIGHT, gpid, normLocale(locale), userId, true);
  }

  @Post('insight/unpublish')
  @ApiOperation({ summary: 'Hide the insight from the public profile' })
  async unpublishInsight(@Req() req: FastifyRequest, @Query('locale') locale?: string) {
    const userId = await getClaimedUserId(req, this.supabase);
    const gpid = await this.requireGpidForUser(userId);
    return this.content.setPublished(INSIGHT, gpid, normLocale(locale), userId, false);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async resolveGlobalPersonId(req: FastifyRequest): Promise<string | null> {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.gpidForUser(userId);
  }

  private async requireGlobalPersonId(req: FastifyRequest): Promise<string> {
    const gpid = await this.resolveGlobalPersonId(req);
    if (!gpid)
      throw new BadRequestException('Claim your fighter profile before configuring an AI key');
    return gpid;
  }

  private async gpidForUser(userId: string): Promise<string | null> {
    const { data } = await this.supabase.service
      .from('global_persons')
      .select('id')
      .eq('claimed_by_user_id', userId)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }

  private async requireGpidForUser(userId: string): Promise<string> {
    const gpid = await this.gpidForUser(userId);
    if (!gpid) throw new BadRequestException('Claim your fighter profile to use insights');
    return gpid;
  }
}
