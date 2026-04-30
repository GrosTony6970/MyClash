import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import { GenerateBracketDto, GeneratePoolsDto } from './dto/phases.dto';

@ApiTags('phases')
@ApiBearerAuth()
@Controller()
export class PhasesController {
  constructor(private readonly phases: PhasesService) {}

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
}
