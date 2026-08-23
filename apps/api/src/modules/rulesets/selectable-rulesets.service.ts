/**
 * apps/api/src/modules/rulesets/selectable-rulesets.service.ts
 *
 * Which rulesets a tournament in a given event may actually be pointed at.
 *
 * The gap this closes: `GET /rulesets` returns `registry.list()`, and the only
 * production `registry.register` calls pass TF_v1 and Generic_PointsCap.
 * Nothing ever registers a DB row. Both tournament ruleset pickers — the
 * creation wizard and the settings Basics tab — read that endpoint, so an
 * organization could author a ruleset, publish it, get it approved for
 * sharing, and then never select it anywhere. Self-service dead-ended one step
 * before the thing it exists to do.
 *
 * The invariant here is deliberately stronger than "list the rows": every
 * entry returned is RESOLVED first, and anything that fails to resolve is
 * dropped. A picker that offers something the resolver will later refuse just
 * moves the failure to standings-render time, where it surfaces as a 400 on a
 * page the organizer cannot debug. Listed and usable are the same set.
 */
import { Injectable, Logger } from '@nestjs/common';
import { RulesetRegistry, type Ruleset } from '@myclash/rulesets';
import { SupabaseService } from '../supabase/supabase.service';
import { RulesetResolver } from '../matches/ruleset-resolver.service';
import { customRulesetOrgVisibilityFilter } from '../../common/custom-ruleset-visibility';
import { toRulesetSummary, type RulesetSummary } from './ruleset-summary';

interface CandidateRow {
  code: string;
  version: string;
}

@Injectable()
export class SelectableRulesetsService {
  private readonly logger = new Logger(SelectableRulesetsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly resolver: RulesetResolver,
    private readonly registry: RulesetRegistry,
  ) {}

  /**
   * Coded built-ins plus every org-visible custom ruleset that resolves.
   *
   * Built-ins come from the registry rather than from their `is_system` mirror
   * rows: the mirrors carry empty `score_formula` placeholders that only mean
   * anything while `is_system` is true, and the registry is what the resolver
   * will short-circuit to anyway.
   */
  async listForOrganization(orgId: string): Promise<RulesetSummary[]> {
    const coded = this.registry.list();
    const seen = new Set(coded.map((r) => `${r.code}@${r.version}`));
    const summaries = coded.map((r) => toRulesetSummary(r, false));

    for (const row of await this.candidateRows(orgId)) {
      const key = `${row.code}@${row.version}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const resolved = await this.resolveQuietly(row);
      if (resolved) summaries.push(toRulesetSummary(resolved, true));
    }

    return summaries;
  }

  /**
   * Non-system rows the org may see. `.or()` is ANDed with the sibling
   * `.eq('is_system', false)`, so this is
   * `(public OR owned OR system) AND NOT system` — i.e. public or owned.
   * The system disjunct is redundant here but the filter is shared with the
   * authoring catalog, where it is not.
   */
  private async candidateRows(orgId: string): Promise<CandidateRow[]> {
    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .select('code, version')
      .eq('is_system', false)
      .or(customRulesetOrgVisibilityFilter(orgId))
      // An archived ruleset still RESOLVES (so tournaments pinned to it keep
      // scoring), but must not be offered for a NEW tournament — decouple
      // "resolvable" from "selectable" here, since this picker equates them.
      .neq('status', 'archived')
      .order('name', { ascending: true });

    if (error) {
      // A picker that 500s is worse than one showing only the built-ins: the
      // organizer can still create the tournament they came to create.
      this.logger.warn(`Failed to list custom rulesets for org ${orgId}: ${error.message}`);
      return [];
    }
    return (data ?? []) as CandidateRow[];
  }

  private async resolveQuietly(row: CandidateRow): Promise<Ruleset | null> {
    try {
      return await this.resolver.resolve(row.code, row.version);
    } catch (err) {
      this.logger.warn(`Ruleset ${row.code}@${row.version} failed to resolve: ${String(err)}`);
      return null;
    }
  }
}
