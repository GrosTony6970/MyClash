'use client';

import Link from 'next/link';
import { useI18n } from '../../i18n/I18nProvider';

interface Props {
  active: 'scoring' | 'penalty';
  /**
   * URL prefix the two tabs link under. Defaults to `/admin/rulesets` for
   * the super-admin pages; organizer pages pass `/org/{slug}/rulesets`.
   */
  basePath?: string;
}

/**
 * Pill-style sub-nav rendered at the top of the Scoring + Penalty ruleset
 * pages so the operator can switch between the two tabs without going back
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
  ];
  return (
    <nav className="mb-6 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={
              isActive
                ? 'rounded-md bg-white px-4 py-1.5 font-semibold text-slate-900 shadow-sm'
                : 'rounded-md px-4 py-1.5 font-medium text-slate-500 hover:text-slate-700'
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
