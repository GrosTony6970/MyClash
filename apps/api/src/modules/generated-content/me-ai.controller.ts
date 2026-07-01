import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AIProvidersService } from '../ai-providers/ai-providers.service';
import { SaveAISettingsDto } from '../ai-providers/dto/ai-settings.dto';
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

  // ── BYOK key ──────────────────────────────────────────────────────────────

  @Get('ai-settings')
  @ApiOperation({ summary: "Get the fighter's own AI key config" })
  async getKey(@Req() req: FastifyRequest) {
    const gpid = await this.resolveGlobalPersonId(req);
    return gpid ? this.providers.getFighterConfig(gpid) : null;
  }

  @Put('ai-settings')
  @ApiOperation({ summary: "Save the fighter's own AI provider key" })
  async saveKey(@Body() dto: SaveAISettingsDto, @Req() req: FastifyRequest) {
    const gpid = await this.requireGlobalPersonId(req);
    await this.providers.saveFighterKey(gpid, dto.provider, dto.apiKey, dto.model ?? null);
    return this.providers.getFighterConfig(gpid);
  }

  @Delete('ai-settings')
  @ApiOperation({ summary: "Remove the fighter's AI key" })
  async deleteKey(@Req() req: FastifyRequest) {
    const gpid = await this.resolveGlobalPersonId(req);
    if (gpid) await this.providers.deleteFighterKey(gpid);
    return { deleted: true };
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
