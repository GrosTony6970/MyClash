import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { ForfeitChanges } from '@myclash/types/forfeit-rules';
import { requireRequestUserId } from '../../common/auth/request-user';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { eventCardRules, loadPenaltyRulesetRow, tournamentCardRules } from './card-rules-pin';
import { forfeitRulesAnswer, type ForfeitRulesAnswer } from './forfeit-rules-in-force';
import { pinnablePenaltyRuleset } from './penalty-version.util';

type Row = Record<string, unknown>;

const PICK_QUERY = {
  name: 'penaltyRulesetId',
  required: false,
  type: 'string',
  format: 'uuid',
  description: 'A penalty ruleset the organisation may pin: its rules, in place of the pin',
} as const;

/**
 * The forfeit rules a Tournament plays, for its Step 1 and Basics tab (ruling 70): the penalty
 * ruleset's, the Tournament's changes, and the two laid over each other. The two routes keep the
 * same bars: with no pick, anyone who runs the Tournament reads the rules it plays (the bar of
 * `GET /tournaments/:id`); a pick is an admin's, of a ruleset the organisation may pin.
 */
@ApiTags('penalties')
@ApiBearerAuth()
@Controller()
export class ForfeitRulesController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  @Get('tournaments/:id/forfeit-rules')
  @ApiOperation({
    summary:
      "The forfeit rules of a Tournament: its penalty ruleset's (or the picked one's), its own changes, and the rules in force (scorekeeper; a pick is an admin's)",
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiQuery(PICK_QUERY)
  async forTournament(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('penaltyRulesetId', new ParseUUIDPipe({ optional: true })) pick: string | undefined,
    @Req() req: FastifyRequest,
  ): Promise<ForfeitRulesAnswer> {
    const userId = await requireRequestUserId(req, this.supabase);
    const db = this.supabase.service;
    const { data, error } = await db
      .from('tournaments')
      .select('event_id, forfeit_rules')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Tournament ${id} was not read: ${error.message}`);
    if (!data) throw new NotFoundException(`Tournament ${id} not found`);
    const tournament = data as { event_id: string; forfeit_rules: ForfeitChanges | null };
    const picked = await this.pickedRules(tournament.event_id, userId, pick);
    if (picked) return forfeitRulesAnswer(picked, tournament.forfeit_rules);
    const { cardRules, changes } = await tournamentCardRules(db, id);
    return forfeitRulesAnswer(cardRules, changes);
  }

  @Get('events/:eventId/forfeit-rules')
  @ApiOperation({
    summary:
      "The forfeit rules a new Tournament of an Event starts with: the Event's penalty ruleset's, else the built-in's, or the picked one's (scorekeeper; a pick is an admin's)",
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiQuery(PICK_QUERY)
  async forEvent(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('penaltyRulesetId', new ParseUUIDPipe({ optional: true })) pick: string | undefined,
    @Req() req: FastifyRequest,
  ): Promise<ForfeitRulesAnswer> {
    const userId = await requireRequestUserId(req, this.supabase);
    const picked = await this.pickedRules(eventId, userId, pick);
    return forfeitRulesAnswer(
      picked ?? (await eventCardRules(this.supabase.service, eventId)),
      null,
    );
  }

  /**
   * The bar of a read, and the picked ruleset's row. No pick: a scorekeeper of the Event's
   * organisation, and `null`. A pick: an admin, then the pin doors' rule, with the same 400 for a
   * missing and a foreign private ruleset, so the answer names no ids.
   */
  private async pickedRules(
    eventId: string,
    userId: string,
    pick: string | undefined,
  ): Promise<Row | null> {
    const db = this.supabase.service;
    const { data, error } = await db
      .from('events')
      .select('organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new Error(`Event ${eventId} was not read: ${error.message}`);
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);
    const orgId = (data as { organization_id: string }).organization_id;
    if (!pick) {
      await this.orgs.assertOrgRole(orgId, userId, 'scorekeeper');
      return null;
    }
    await this.orgs.assertOrgRole(orgId, userId, 'admin');
    const row = (await pinnablePenaltyRuleset(this.supabase, pick, orgId))
      ? await loadPenaltyRulesetRow(db, pick)
      : null;
    if (!row) {
      throw new BadRequestException('This penalty ruleset is not available to this organisation');
    }
    return row;
  }
}
