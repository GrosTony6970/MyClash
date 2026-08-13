'use client';

import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';

interface Props {
  active: 'plan' | 'referees';
  /**
   * URL the tabs link under, e.g. `/org/{slug}/events/{eventId}/compensation`.
   * The "Referee compensation" tab is the base path itself; "Compensation
   * plan" is `${basePath}/plan`.
   */
  basePath: string;
}

/**
 * Pill-style sub-nav at the top of the event Compensation pages, switching
 * between the org-wide "Compensation plan" (rates + tiers) and the event's
 * "Referee compensation" report. Mirrors RulesetsTopNav.
 */
export function CompensationTopNav({ active, basePath }: Props) {
  const { t } = useI18n();
  const tabs = [
    {
      key: 'plan' as const,
      href: `${basePath}/plan`,
      label: t('organizer.compensation.tabPlan'),
    },
    {
      key: 'referees' as const,
      href: basePath,
      label: t('organizer.compensation.tabReferees'),
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
