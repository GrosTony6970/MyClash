import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { registry, TF_v1, Generic_PointsCap } from '@myclash/rulesets';
import { SupabaseService } from '../supabase/supabase.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { resolveRequestUserId } from '../../common/auth/request-user';
import { SelectableRulesetsService } from './selectable-rulesets.service';
import { toRulesetSummary, type RulesetSummary } from './ruleset-summary';

// Ensure all built-in rulesets are registered (idempotent — guarded with has()).
// This mirrors the same guard in scoring.service.ts so either module can load first.
for (const ruleset of [TF_v1, Generic_PointsCap]) {
  if (!registry.has(ruleset.code, ruleset.version)) {
    registry.register(ruleset);
  }
}

@ApiTags('rulesets')
@Controller('rulesets')
export class RulesetsController {
  constructor(
    private readonly selectable: SelectableRulesetsService,
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  /**
   * GET /api/v1/rulesets — the coded catalog.
   *
   * Registry-only, and intentionally so: it needs no org context. It is NOT
   * sufficient for a tournament ruleset picker, because an org-authored
   * ruleset is never in the registry — use `for-event/:eventId` there.
   */
  @Get()
  @ApiOperation({ summary: 'List the coded (built-in) rulesets' })
  list(): RulesetSummary[] {
    return registry.list().map((ruleset) => toRulesetSummary(ruleset, false));
  }

  /**
   * GET /api/v1/rulesets/for-event/:eventId — every ruleset a tournament in
   * this event may be pointed at: the built-ins plus the owning org's own and
   * publicly shared custom rulesets.
   *
   * Declared BEFORE any `@Get(':param')` route would be. Nest matches in
   * declaration order, so a literal path registered after a parameter route on
   * the same controller gets shadowed by it — and with ParseUUIDPipe on the
   * parameter that shows up as a confusing 400 rather than a 404.
   *
   * Keyed on the event rather than the org because that is what both callers
   * already hold — the wizard takes `eventId` as a prop, the settings tab reads
   * it from the route — so neither needs an extra round trip to resolve the
   * organization. Authorization then derives from the event's org using the
   * same 'admin' role `createTournament` itself asserts, so this can never
   * show rulesets to someone who could not create the tournament.
   */
  @Get('for-event/:eventId')
  @ApiOperation({ summary: 'List rulesets selectable for tournaments in this event' })
  async listForEvent(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ): Promise<RulesetSummary[]> {
    const { data } = await this.supabase.service
      .from('events')
      .select('organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);

    const orgId = (data as { organization_id: string }).organization_id;
    const userId = await resolveRequestUserId(req, this.supabase);
    await this.orgs.assertOrgRole(orgId, userId, 'admin');

    return this.selectable.listForOrganization(orgId);
  }
}
