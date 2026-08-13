'use client';

import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';

interface Props {
  active: 'scoring' | 'penalty' | 'league';
  /**
   * URL prefix the three tabs link under. Defaults to `/admin/rulesets`
   * for the super-admin pages; organizer pages pass `/org/{slug}/rulesets`.
   */
  basePath?: string;
}

/**
 * Pill-style sub-nav rendered at the top of the Scoring + Penalty + League
 * ruleset pages so the operator can switch between tabs without going back
 * through the side menu. Used by both the super-admin (/admin/rulesets/*)
 * and organizer (/org/[slug]/rulesets/*) surfaces via the `basePath` prop.
 */
export function RulesetsTopNav({ active, basePath = '/admin/rulesets' }: Props) {
  const { t } = useI18n();
  const tabs = [
    {
      key: 'scoring' as const,
      href: `${basePath}/scoring`,
      label: t('admin.rulesets.tabScoring'),
    },
    {
      key: 'penalty' as const,
      href: `${basePath}/penalty`,
      label: t('admin.rulesets.tabPenalty'),
    },
    {
      key: 'league' as const,
      href: `${basePath}/league`,
      label: t('admin.rulesets.tabLeague'),
    },
  ];
  return (
    <nav className="mb-6 flex gap-1 rounded-lg border border-border bg-background p-1 text-sm">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={
              isActive
                ? 'rounded-md bg-surface px-4 py-1.5 font-semibold text-foreground shadow-sm'
                : 'rounded-md px-4 py-1.5 font-medium text-muted hover:text-foreground-secondary'
            }
            aria-current={isActive ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
