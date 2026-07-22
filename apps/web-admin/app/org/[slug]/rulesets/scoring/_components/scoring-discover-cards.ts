import type { TranslationValues } from '@myclash/i18n';
import type { DiscoverCardData } from '../../../../../../src/components/rulesets/RulesetDiscoverTab';

type Translate = (key: string, values?: TranslationValues) => string;

interface CatalogScoringRow {
  id: string;
  code: string;
  version: string;
  name: string;
  description: string | null;
  is_system: boolean;
  base_code: string | null;
  owner_organization_name: string | null;
  targets: Array<{ name: string; value: number }> | null;
  has_afterblow: boolean;
}

/** Map scoring catalog rows to Discover cards (grammar chips + fork lineage). */
export function toScoringDiscoverCards(
  rows: unknown[],
  t: Translate,
  slug: string,
): DiscoverCardData[] {
  const list = rows as CatalogScoringRow[];
  return list.map((row) => {
    const chips: string[] = [];
    if (row.targets && row.targets.length > 0)
      chips.push(t('admin.rulesets.discover.targetsChip', { count: row.targets.length }));
    if (row.has_afterblow) chips.push(t('admin.rulesets.discover.afterblowChip'));
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      description: row.description,
      isBuiltIn: row.is_system,
      ownerOrganizationName: row.owner_organization_name,
      forkedFromName: row.base_code
        ? (list.find((r) => r.code === row.base_code)?.name ?? row.base_code)
        : null,
      chips,
      adoptHref: `/org/${slug}/rulesets/scoring/new?cloneFrom=${row.id}`,
      viewHref: `/org/${slug}/rulesets/scoring/${row.id}/edit`,
    };
  });
}
