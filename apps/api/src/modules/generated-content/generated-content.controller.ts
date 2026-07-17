import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { Public } from '../../common/auth/public.decorator';
import { GeneratedContentService } from './generated-content.service';

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

/** Only EN/FR are supported; anything else falls back to EN (the default locale). */
function normLocale(locale: string | undefined): string {
  return locale === 'fr' ? 'fr' : 'en';
}

@ApiTags('generated-content')
@ApiBearerAuth()
@Controller('generated-content')
export class GeneratedContentController {
  constructor(
    private readonly service: GeneratedContentService,
    private readonly supabase: SupabaseService,
  ) {}

  @Post(':type/:entityId/generate')
  @ApiOperation({ summary: 'Generate (or regenerate) AI content for an entity' })
  @ApiParam({ name: 'entityId', type: 'string', format: 'uuid' })
  async generate(
    @Param('type') type: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Req() req: FastifyRequest,
    @Query('locale') locale?: string,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.service.generate(type, entityId, normLocale(locale), userId);
  }

  @Get(':type/:entityId')
  @ApiOperation({ summary: 'Get cached AI content (draft or published) for an authorized viewer' })
  async get(
    @Param('type') type: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Req() req: FastifyRequest,
    @Query('locale') locale?: string,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.service.get(type, entityId, normLocale(locale), userId);
  }

  @Post(':type/:entityId/publish')
  @ApiOperation({ summary: 'Publish generated content to its public surface' })
  async publish(
    @Param('type') type: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Req() req: FastifyRequest,
    @Query('locale') locale?: string,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.service.setPublished(type, entityId, normLocale(locale), userId, true);
  }

  @Post(':type/:entityId/unpublish')
  @ApiOperation({ summary: 'Retract published content back to a private draft' })
  async unpublish(
    @Param('type') type: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Req() req: FastifyRequest,
    @Query('locale') locale?: string,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.service.setPublished(type, entityId, normLocale(locale), userId, false);
  }
}

/** Public, unauthenticated read of PUBLISHED content only (powers public pages). */
@ApiTags('generated-content')
@Public()
@Controller('public/generated-content')
export class PublicGeneratedContentController {
  constructor(private readonly service: GeneratedContentService) {}

  @Get(':type/:entityId')
  @ApiOperation({ summary: 'Public published AI content for an entity (null if none)' })
  @ApiParam({ name: 'entityId', type: 'string', format: 'uuid' })
  async getPublished(
    @Param('type') type: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Query('locale') locale?: string,
  ) {
    return this.service.getPublished(type, entityId, normLocale(locale));
  }
}
