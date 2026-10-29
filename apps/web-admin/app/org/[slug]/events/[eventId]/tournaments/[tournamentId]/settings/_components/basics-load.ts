import { apiRequest } from '@myclash/api-client';
import { applyForfeitPatch, type ForfeitChanges } from '@myclash/types/forfeit-rules';
import { getPublicApiUrl } from '@/lib/api-url';
import { fetchSelectableRulesets } from '@/lib/selectable-rulesets';
import type { TournamentBasics } from './basics-save';

const apiUrl = getPublicApiUrl();

export interface Ruleset {
  code: string;
  version: string;
  label: string;
}
export interface PenaltyRuleset {
  id: string;
  name: string;
}

/**
 * What the Basics tab reads when it opens: the Tournament's row, the rulesets its Event may use,
 * and its club's penalty rulesets. Silent reads: the tab shows its loading line until the row
 * lands, and every save reports its own refusal. A failed org resolve leaves the penalty list
 * empty: the platform-wide catalogue is for platform staff.
 */
export async function loadBasics(orgSlug: string, tournamentId: string, eventId: string) {
  // The org id, from its slug, for the org-scoped penalty rulesets (it filters out other orgs'
  // public ones).
  const org = await apiRequest<{ id: string }>(
    apiUrl,
    `/api/v1/organizations/slug/${encodeURIComponent(orgSlug)}`,
  );
  const [row, rulesets, penaltyRulesets] = await Promise.all([
    apiRequest<Record<string, unknown>>(apiUrl, `/api/v1/tournaments/${tournamentId}`).then((r) =>
      r.ok ? r.data : null,
    ),
    // Event-scoped, so an org-authored ruleset stays selectable here. The bare /rulesets catalog
    // is registry-only and never contains one.
    fetchSelectableRulesets(apiUrl, eventId),
    org.ok
      ? apiRequest<PenaltyRuleset[]>(
          apiUrl,
          `/api/v1/organizations/${org.data.id}/penalty-rulesets`,
        ).then((r) => (r.ok ? r.data : []))
      : [],
  ]);
  return { row, rulesets: rulesets as Ruleset[], penaltyRulesets };
}

/** The Basics form of a Tournament row, and its forfeit changes as stored. */
export function basicsOf(row: Record<string, unknown>): {
  form: TournamentBasics;
  forfeit: ForfeitChanges | null;
} {
  // As stored: a restored archive's `{}` is no change, as the server reads it.
  const forfeit = applyForfeitPatch((row['forfeit_rules'] as ForfeitChanges | null) ?? null, {});
  return {
    form: {
      name: row['name'] as string,
      slug: row['slug'] as string,
      weapon: row['weapon'] as string,
      rulesetCode: row['ruleset_code'] as string,
      rulesetVersion: row['ruleset_version'] as string,
      penaltyRulesetId: (row['penalty_ruleset_id'] as string | null) ?? null,
      maxParticipants: (row['max_participants'] as number | null) ?? null,
      maxWaitlist: (row['max_waitlist'] as number | null) ?? null,
      forfeitRules: forfeit,
    },
    forfeit,
  };
}
