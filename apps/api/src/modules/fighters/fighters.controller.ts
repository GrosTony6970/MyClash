import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { SupabaseService } from '../supabase/supabase.service';
import { FightersService } from './fighters.service';
import {
  CreateFighterDto,
  FighterQueryDto,
  MergeFightersDto,
  PromoteFighterDto,
  UpdateFighterDto,
} from './dto/fighters.dto';

/** Extract claimed user ID from Supabase JWT in request. */
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

@ApiTags('fighters')
@Controller('fighters')
export class FightersController {
  constructor(
    private readonly fighters: FightersService,
    private readonly supabase: SupabaseService,
  ) {}

  /** GET /api/v1/fighters?q=...&club=... */
  @Get()
  @ApiOperation({ summary: 'List fighters (public)' })
  async list(@Query() query: FighterQueryDto) {
    return this.fighters.list(query);
  }

  /** GET /api/v1/fighters/:slug */
  @Get(':slug')
  @ApiOperation({ summary: 'Get fighter by slug (public)' })
  async getBySlug(@Param('slug') slug: string) {
    return this.fighters.getBySlug(slug);
  }

  /** POST /api/v1/fighters */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a fighter (organizer+)' })
  async create(@Body() dto: CreateFighterDto) {
    return this.fighters.create(dto);
  }

  /** PATCH /api/v1/fighters/:id */
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a fighter (organizer+ or claimed owner)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFighterDto) {
    return this.fighters.update(id, dto);
  }

  /**
   * POST /api/v1/fighters/:id/promote
   * Promotes a Person to a global Fighter profile.
   * Requires a claimed account whose persons.id matches the Person.
   */
  @Post(':id/promote')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Promote a Person to global Fighter (claimed user only)' })
  async promote(@Body() dto: PromoteFighterDto, @Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.fighters.promote(dto, userId);
  }

  /**
   * POST /api/v1/fighters/merge
   * Merge two fighter profiles (super admin only).
   */
  @Post('merge')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Merge two fighter profiles (super admin)' })
  async merge(@Body() dto: MergeFightersDto) {
    return this.fighters.merge(dto);
  }
}
