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
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import {
  AssignPenaltyRulesetDto,
  CreatePenaltyDto,
  CreatePenaltyRulesetDto,
  ImportPenaltyRulesetCsvDto,
  ReviewPenaltyDto,
  VoidPenaltyDto,
} from './dto/penalties.dto';
import { PenaltiesService } from './penalties.service';

async function getOptionalUserId(
  req: FastifyRequest,
  supabase: SupabaseService,
): Promise<string | undefined> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) return undefined;
  const {
    data: { user },
  } = await supabase.anon.auth.getUser(token);
  return user?.id;
}

@ApiTags('penalties')
@ApiBearerAuth()
@Controller()
export class PenaltiesController {
  constructor(
    private readonly penalties: PenaltiesService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('penalty-rulesets')
  @ApiOperation({ summary: 'List penalty rulesets visible to the current user' })
  async listRulesets() {
    return this.penalties.listRulesets();
  }

  @Get('penalty-rulesets/:id')
  @ApiOperation({ summary: 'Get a penalty ruleset with entries' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getRuleset(@Param('id', ParseUUIDPipe) id: string) {
    return this.penalties.getRuleset(id);
  }

  @Post('penalty-rulesets')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a custom penalty ruleset' })
  async createRuleset(@Body() dto: CreatePenaltyRulesetDto, @Req() req: FastifyRequest) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.createRuleset(dto, userId);
  }

  @Post('penalty-rulesets/import-csv')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Import a custom penalty ruleset from CSV' })
  async importRuleset(@Body() dto: ImportPenaltyRulesetCsvDto, @Req() req: FastifyRequest) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.importRulesetCsv(dto, userId);
  }

  @Patch('events/:id/penalty-ruleset')
  @ApiOperation({ summary: 'Attach a penalty ruleset as event default' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async assignEventRuleset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPenaltyRulesetDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.assignEventRuleset(id, dto, userId);
  }

  @Patch('tournaments/:id/penalty-ruleset')
  @ApiOperation({ summary: 'Attach a penalty ruleset to a tournament' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async assignTournamentRuleset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPenaltyRulesetDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.assignTournamentRuleset(id, dto, userId);
  }

  @Get('matches/:id/penalties')
  @ApiOperation({ summary: 'List penalties for a match' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async listMatchPenalties(@Param('id', ParseUUIDPipe) id: string) {
    return this.penalties.listMatchPenalties(id);
  }

  @Get('matches/:id/penalty-ruleset')
  @ApiOperation({ summary: 'Get the effective penalty ruleset for a match' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getMatchPenaltyRuleset(@Param('id', ParseUUIDPipe) id: string) {
    return this.penalties.getEffectiveRulesetForMatch(id);
  }

  @Post('matches/:id/penalties')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a match penalty card' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async createPenalty(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePenaltyDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.createPenalty(id, dto, { userId });
  }

  @Patch('match-penalties/:id/void')
  @ApiOperation({ summary: 'Void a match penalty without deleting it' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async voidPenalty(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidPenaltyDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.voidPenalty(id, dto, userId);
  }

  @Get('tournaments/:id/penalty-reviews')
  @ApiOperation({ summary: 'List pending penalty reviews for a tournament' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async listTournamentReviews(@Param('id', ParseUUIDPipe) id: string) {
    return this.penalties.listTournamentReviews(id);
  }

  @Patch('tournament-penalty-reviews/:id')
  @ApiOperation({ summary: 'Confirm or dismiss a tournament penalty review' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async reviewTournamentPenalty(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewPenaltyDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.reviewTournamentPenalty(id, dto, userId);
  }
}
