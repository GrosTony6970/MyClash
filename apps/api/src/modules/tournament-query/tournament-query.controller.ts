import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { TournamentQueryDto, TournamentQuerySettingsDto } from './dto/tournament-query.dto';
import { TournamentQueryService } from './tournament-query.service';

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

@ApiTags('tournament-query')
@ApiBearerAuth()
@Controller('tournaments/:tournamentId/query')
export class TournamentQueryController {
  constructor(
    private readonly service: TournamentQueryService,
    private readonly supabase: SupabaseService,
  ) {}

  @Post('estimate')
  @ApiOperation({ summary: 'Estimate natural-language query cost' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async estimate(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body() dto: TournamentQueryDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.service.estimate(tournamentId, userId, dto);
  }

  @Post()
  @ApiOperation({ summary: 'Ask a natural-language question about a tournament' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async query(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body() dto: TournamentQueryDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.service.query(tournamentId, userId, dto);
  }

  @Get('history')
  @ApiOperation({ summary: 'List the current user query history for a tournament' })
  async history(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.service.history(tournamentId, userId);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get tournament natural-language query settings' })
  async settings(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.service.getSettingsForTournament(tournamentId, userId);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update tournament natural-language query settings' })
  async saveSettings(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body() dto: TournamentQuerySettingsDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.service.saveSettings(tournamentId, userId, dto);
  }
}
