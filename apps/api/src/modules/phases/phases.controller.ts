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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PhasesService } from './phases.service';
import { SupabaseService } from '../supabase/supabase.service';
import { GenerateBracketDto, GeneratePoolsDto, UpdatePhaseVisibilityDto } from './dto/phases.dto';
import type { FastifyRequest } from 'fastify';

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

@ApiTags('phases')
@ApiBearerAuth()
@Controller()
export class PhasesController {
  constructor(
    private readonly phases: PhasesService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * POST /api/v1/tournaments/:tournamentId/generate-pools
   *
   * Generates pool phase: creates phase, pools, pool_members, and
   * round-robin matches (Berger tables) for each pool.
   *
   * Idempotent: returns 409 if pool phase already exists.
   * Use ?force=true to regenerate (deletes existing phase first).
   */
  @Post('tournaments/:tournamentId/generate-pools')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate pool phase with Berger round-robin matches' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  @ApiQuery({
    name: 'force',
    required: false,
    type: Boolean,
    description: 'Overwrite existing pool phase',
  })
  @ApiResponse({ status: 201, description: 'Pool phase created' })
  @ApiResponse({ status: 409, description: 'Pool phase already exists (use ?force=true)' })
  async generatePools(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body() dto: GeneratePoolsDto,
    @Query('force') force?: string,
  ) {
    return this.phases.generatePools(tournamentId, dto, force === 'true');
  }

  @Get('tournaments/:tournamentId/pools')
  @ApiOperation({ summary: 'List generated pools for a tournament' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async listPools(@Param('tournamentId', ParseUUIDPipe) tournamentId: string) {
    return this.phases.listTournamentPools(tournamentId);
  }

  /**
   * POST /api/v1/tournaments/:tournamentId/generate-bracket
   *
   * Generates single-elimination bracket phase from top-N qualifiers.
   *
   * Idempotent: returns 409 if elim phase already exists.
   * Use ?force=true to regenerate.
   */
  @Post('tournaments/:tournamentId/generate-bracket')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate single-elimination bracket phase' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  @ApiQuery({
    name: 'force',
    required: false,
    type: Boolean,
    description: 'Overwrite existing bracket phase',
  })
  @ApiResponse({ status: 201, description: 'Bracket phase created' })
  @ApiResponse({ status: 409, description: 'Bracket phase already exists (use ?force=true)' })
  async generateBracket(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body() dto: GenerateBracketDto,
    @Query('force') force?: string,
  ) {
    return this.phases.generateBracket(tournamentId, dto, force === 'true');
  }

  @Get('tournaments/:tournamentId/bracket')
  @ApiOperation({ summary: 'Get generated bracket for a tournament' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async getBracket(@Param('tournamentId', ParseUUIDPipe) tournamentId: string) {
    return this.phases.getTournamentBracket(tournamentId);
  }

  @Patch('phases/:phaseId/visibility')
  @ApiOperation({ summary: 'Publish or hide a tournament phase (org admin+)' })
  @ApiParam({ name: 'phaseId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Phase visibility updated' })
  @ApiResponse({ status: 409, description: 'Confirmation required to hide started matches' })
  async updateVisibility(
    @Param('phaseId', ParseUUIDPipe) phaseId: string,
    @Body() dto: UpdatePhaseVisibilityDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.phases.updateVisibility(phaseId, userId, dto);
  }
}
