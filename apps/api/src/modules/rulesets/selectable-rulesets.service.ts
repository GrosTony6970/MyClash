/**
 * apps/api/src/modules/rulesets/selectable-rulesets.service.ts
 *
 * Which rulesets a tournament in a given event may actually be pointed at.
 *
 * The gap this closes: `GET /rulesets` returns the registry, and the only
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
import { hasPlatformTier } from '../../common/auth/platform-role';
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
   * will short-circuit to anyway. The latest version of each only: an older
   * one stays registered for the bouts fought under it, not for new ones.
   */
  async listForOrganization(
    orgId: string,
    { withDrafts = false }: { withDrafts?: boolean } = {},
  ): Promise<RulesetSummary[]> {
    const coded = this.registry.latestOfEach();
    // Every registered version, not only the offered ones: a database row named
    // like an older built-in resolves to that engine and must not be listed.
    const seen = new Set(this.registry.list().map((r) => `${r.code}@${r.version}`));
    const summaries = coded.map((r) => toRulesetSummary(r, false));

    for (const row of await this.candidateRows(orgId, withDrafts)) {
      const key = `${row.code}@${row.version}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const resolved = await this.resolveQuietly(row);
      if (resolved) summaries.push(toRulesetSummary(resolved, true));
    }

    return summaries;
  }

  /**
   * Are platform drafts offered to this user? To platform_admin and above, who
   * author them (ruling "Drafts for whom", 2026-10-18, widening "Pinning a
   * draft"). The one owner for the picker and the doors.
   */
  draftsOfferedTo(userId: string): Promise<boolean> {
    return hasPlatformTier(this.supabase, userId, 'platform_admin');
  }

  /** The club rows the picker lists, by name. */
  private async candidateRows(orgId: string, withDrafts: boolean): Promise<CandidateRow[]> {
    const { data, error } = await this.offered(orgId, withDrafts).order('name', {
      ascending: true,
    });

    if (error) {
      // A picker that 500s is worse than one showing only the built-ins: the
      // organizer can still create the tournament they came to create.
      this.logger.warn(`Failed to list custom rulesets for org ${orgId}: ${error.message}`);
      return [];
    }
    return (data ?? []) as CandidateRow[];
  }

  /**
   * The version at which a Tournament of `orgId` may be pointed at this club
   * ruleset, or null. The doors that set a Tournament's pair ask this, so
   * "listed" and "usable" are one set: another club's private ruleset, an
   * archived one, or a draft for anyone `draftsOfferedTo` refuses, answers null
   * as an unknown one does. With no version named, the ruleset's current one,
   * as the picker lists it (ruling "No version named", 2026-10-18); a version
   * named must be that one. A built-in is the caller's to answer (it has no
   * row here). A read that fails throws: a door answers it as the server's
   * fault, never as "does not exist".
   */
  async offeredVersion(
    orgId: string,
    code: string,
    version: string | undefined,
    { withDrafts = false }: { withDrafts?: boolean } = {},
  ): Promise<string | null> {
    let query = this.offered(orgId, withDrafts).eq('code', code);
    if (version !== undefined) query = query.eq('version', version);
    // A code has one row across every owner (migration 0224's unique index).
    const { data, error } = await query.limit(1);
    const pair = version === undefined ? code : `${code}@${version}`;
    if (error) throw new Error(`Failed to read the ruleset ${pair}: ${error.message}`);
    const [row] = (data ?? []) as CandidateRow[];
    if (!row) return null;
    return (await this.resolver.resolve(code, row.version)) ? row.version : null;
  }

  /**
   * May a restored Tournament or bout of `orgId` keep this club pair? A restore
   * brings back what was pinned, at any version that still resolves (ruling
   * "Restore a pair", 2026-10-18, and the operator's two answers of that day):
   * the club's own ruleset whatever its status, archived or back in draft; a
   * shared one unless it is a draft; a platform draft as `draftsOfferedTo`
   * says. Another club's private ruleset never. A read that fails throws, as
   * `offeredVersion` does. Its own scope on purpose, so a hand copy of
   * `customRulesetOrgVisibilityFilter`'s "own" and "shared": a change of what
   * "shared" means belongs in both.
   */
  async restorable(
    orgId: string,
    code: string,
    version: string,
    { withDrafts = false }: { withDrafts?: boolean } = {},
  ): Promise<boolean> {
    const kept = [
      `owner_organization_id.eq.${orgId}`,
      'and(public_visibility.eq.true,status.neq.draft)',
    ];
    if (withDrafts) kept.push('and(status.eq.draft,owner_organization_id.is.null)');
    const { data, error } = await this.supabase.service
      .from('custom_rulesets')
      .select('code, version')
      .eq('is_system', false)
      .eq('code', code)
      .or(kept.join(','))
      .limit(1);
    if (error) throw new Error(`Failed to read the ruleset ${code}@${version}: ${error.message}`);
    if (!data?.length) return false;
    return (await this.resolver.resolve(code, version)) !== null;
  }

  /**
   * The club rows offered to an organization: the one scope of the picker's
   * list and of the doors' check (a restore has its own, `restorable`).
   * Non-system rows the org may see. `.or()` is
   * ANDed with the sibling `.eq('is_system', false)`, so this is
   * `(public OR owned OR system) AND NOT system` — i.e. public or owned.
   * The system disjunct is redundant here but the filter is shared with the
   * authoring catalog, where it is not.
   */
  private offered(orgId: string, withDrafts: boolean) {
    const visible = customRulesetOrgVisibilityFilter(orgId);
    let query = this.supabase.service
      .from('custom_rulesets')
      .select('code, version')
      .eq('is_system', false)
      // A draft resolves (ruling 6), so this picker cannot rely on the resolver
      // to hide one. The platform's own drafts (no owner, not shared yet, so
      // the organization's filter alone would not list them) are offered as
      // `draftsOfferedTo` says; an organization's row put back to draft is
      // offered to nobody.
      .or(
        withDrafts
          ? `and(status.neq.draft,or(${visible})),and(status.eq.draft,owner_organization_id.is.null)`
          : visible,
      )
      // An archived ruleset still RESOLVES (so tournaments pinned to it keep
      // scoring), but must not be offered for a NEW tournament — decouple
      // "resolvable" from "selectable" here, since this picker equates them.
      .neq('status', 'archived');
    if (!withDrafts) query = query.neq('status', 'draft');
    return query;
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
