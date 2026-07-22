import type { TranslationValues } from '@myclash/i18n';
import type { DiscoverCardData } from '../../../../../../src/components/rulesets/RulesetDiscoverTab';

type Translate = (key: string, values?: TranslationValues) => string;

interface CatalogPenaltyRow {
  id: string;
  code: string;
  version: string;
  name: string;
  description: string | null;
  built_in: boolean;
  owner_organization_name: string | null;
  accumulation_scope: 'match' | 'phase' | 'tournament';
}

/** Map penalty catalog rows to Discover cards (accumulation-scope chip). */
export function toPenaltyDiscoverCards(
  rows: unknown[],
  t: Translate,
  slug: string,
): DiscoverCardData[] {
  const list = rows as CatalogPenaltyRow[];
  return list.map((row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    isBuiltIn: row.built_in,
    ownerOrganizationName: row.owner_organization_name,
    chips: [t(`admin.penaltyRulesets.scope.${row.accumulation_scope}`)],
    adoptHref: `/org/${slug}/rulesets/penalty/new?cloneFrom=${row.id}`,
    viewHref: `/org/${slug}/rulesets/penalty/${row.id}/edit`,
  }));
}
