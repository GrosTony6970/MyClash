'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../src/i18n/I18nProvider';

type DashboardStats = {
  generatedAt: string;
  organizations: { total: number; active: number; suspended: number };
  events: { total: number; draft: number; publishedOrRunning: number; completed: number };
  tournaments: { total: number; draft: number; active: number; completed: number };
  people: {
    globalPersons: number;
    fighters: number;
    eventPersons: number;
    claimedProfiles: number;
  };
  activity: {
    registrations: number;
    matches: number;
    completedMatches: number;
    exchanges: number;
  };
  recent: {
    days: number;
    newOrganizations: number;
    newEvents: number;
    newTournaments: number;
    newGlobalPersons: number;
    completedMatches: number;
  };
};

const sections = [
  {
    href: '/admin/organizations',
    titleKey: 'admin.dashboard.cards.organizationsTitle',
    descriptionKey: 'admin.dashboard.cards.organizationsDescription',
    badge: 'OR',
  },
  {
    href: '/admin/users',
    titleKey: 'admin.dashboard.cards.usersTitle',
    descriptionKey: 'admin.dashboard.cards.usersDescription',
    badge: 'U',
  },
  {
    href: '/admin/fighters',
    titleKey: 'admin.dashboard.cards.fightersTitle',
    descriptionKey: 'admin.dashboard.cards.fightersDescription',
    badge: 'F',
  },
  {
    href: '/admin/clubs',
    titleKey: 'admin.dashboard.cards.clubsTitle',
    descriptionKey: 'admin.dashboard.cards.clubsDescription',
    badge: 'C',
  },
  {
    href: '/admin/rulesets',
    titleKey: 'admin.dashboard.cards.rulesetsTitle',
    descriptionKey: 'admin.dashboard.cards.rulesetsDescription',
    badge: 'R',
  },
  {
    href: '/admin/feature-flags',
    titleKey: 'admin.dashboard.cards.featureFlagsTitle',
    descriptionKey: 'admin.dashboard.cards.featureFlagsDescription',
    badge: 'FF',
  },
  {
    href: '/admin/audit-log',
    titleKey: 'admin.dashboard.cards.auditLogTitle',
    descriptionKey: 'admin.dashboard.cards.auditLogDescription',
    badge: 'A',
  },
  {
    href: '/admin/exchange-edit-requests',
    titleKey: 'admin.dashboard.cards.frozenResultsTitle',
    descriptionKey: 'admin.dashboard.cards.frozenResultsDescription',
    badge: 'FR',
  },
  {
    href: '/admin/system-versions',
    titleKey: 'admin.dashboard.systemVersionsTitle',
    descriptionKey: 'admin.dashboard.systemVersionsDescription',
    badge: 'S',
  },
  {
    href: '/admin/backups',
    titleKey: 'admin.dashboard.backupsTitle',
    descriptionKey: 'admin.dashboard.backupsDescription',
    badge: 'B',
  },
  {
    href: '/admin/leagues',
    titleKey: 'admin.dashboard.leaguesTitle',
    descriptionKey: 'admin.dashboard.leaguesDescription',
    badge: 'L',
  },
  {
    href: '/admin/ai-settings',
    titleKey: 'admin.dashboard.aiSettingsTitle',
    descriptionKey: 'admin.dashboard.aiSettingsDescription',
    badge: 'AI',
  },
  {
    href: '/admin/data-quality',
    titleKey: 'admin.dashboard.dataQualityTitle',
    descriptionKey: 'admin.dashboard.dataQualityDescription',
    badge: 'DQ',
  },
] as const;

function formatNumber(value: number) {
  return new Intl.NumberFormat('fr-FR').format(value);
}

export default function SuperAdminDashboardPage() {
  const { t } = useI18n();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/admin/dashboard-stats`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          throw new Error(t('admin.dashboard.statsAccessDenied'));
        }
        if (!res.ok) throw new Error(t('admin.dashboard.statsLoadError'));
        return (await res.json()) as DashboardStats;
      })
      .then((data) => {
        setStats(data);
        setStatsError(null);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setStatsError(
            error instanceof Error ? error.message : t('admin.dashboard.statsLoadError'),
          );
        }
      })
      .finally(() => setLoadingStats(false));

    return () => controller.abort();
  }, [apiUrl, t]);

  const metricCards = useMemo(() => {
    if (!stats) return [];
    return [
      {
        label: t('admin.dashboard.stats.organizations'),
        value: stats.organizations.total,
        detail: t('admin.dashboard.stats.organizationsDetail', {
          active: stats.organizations.active,
          suspended: stats.organizations.suspended,
        }),
        accent: 'border-[#1d4ed8]',
      },
      {
        label: t('admin.dashboard.stats.eventsLive'),
        value: stats.events.publishedOrRunning,
        detail: t('admin.dashboard.stats.eventsLiveDetail', { total: stats.events.total }),
        accent: 'border-[#dc2626]',
      },
      {
        label: t('admin.dashboard.stats.eventsCompleted'),
        value: stats.events.completed,
        detail: t('admin.dashboard.stats.eventsCompletedDetail', { draft: stats.events.draft }),
        accent: 'border-[#f59e0b]',
      },
      {
        label: t('admin.dashboard.stats.tournamentsCreated'),
        value: stats.tournaments.total,
        detail: t('admin.dashboard.stats.tournamentsCreatedDetail', {
          active: stats.tournaments.active,
        }),
        accent: 'border-[#1d4ed8]',
      },
      {
        label: t('admin.dashboard.stats.tournamentsCompleted'),
        value: stats.tournaments.completed,
        detail: t('admin.dashboard.stats.tournamentsCompletedDetail', {
          draft: stats.tournaments.draft,
        }),
        accent: 'border-[#dc2626]',
      },
      {
        label: t('admin.dashboard.stats.fighters'),
        value: stats.people.fighters,
        detail: t('admin.dashboard.stats.fightersDetail', {
          global: stats.people.globalPersons,
        }),
        accent: 'border-[#f59e0b]',
      },
      {
        label: t('admin.dashboard.stats.registrations'),
        value: stats.activity.registrations,
        detail: t('admin.dashboard.stats.registrationsDetail', {
          persons: stats.people.eventPersons,
        }),
        accent: 'border-[#1d4ed8]',
      },
      {
        label: t('admin.dashboard.stats.completedMatches'),
        value: stats.activity.completedMatches,
        detail: t('admin.dashboard.stats.completedMatchesDetail', {
          total: stats.activity.matches,
        }),
        accent: 'border-[#dc2626]',
      },
      {
        label: t('admin.dashboard.stats.exchanges'),
        value: stats.activity.exchanges,
        detail: t('admin.dashboard.stats.exchangesDetail', {
          claimed: stats.people.claimedProfiles,
        }),
        accent: 'border-[#f59e0b]',
      },
    ];
  }, [stats, t]);

  return (
    <main className="p-5 sm:p-8">
      <div className="mb-8">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#dc2626]">
          {t('admin.dashboard.eyebrow')}
        </p>
        <h1 className="mt-2 text-3xl font-bold text-[#0f172a]">{t('admin.dashboard.title')}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          {t('admin.dashboard.description')}
        </p>
      </div>

      <section className="mb-8 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-[#0f172a]">{t('admin.dashboard.statsTitle')}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('admin.dashboard.statsDescription')}</p>
          </div>
          {stats && (
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              {t('admin.dashboard.statsUpdated', {
                date: new Date(stats.generatedAt).toLocaleString('fr-FR'),
              })}
            </p>
          )}
        </div>

        {loadingStats ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            {t('admin.dashboard.statsLoading')}
          </p>
        ) : statsError ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {statsError}
          </p>
        ) : stats ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {metricCards.map((card) => (
                <div
                  key={card.label}
                  className={`rounded-md border border-l-4 bg-slate-50 p-4 ${card.accent}`}
                >
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                    {card.label}
                  </p>
                  <p className="mt-2 text-3xl font-bold text-[#0f172a]">
                    {formatNumber(card.value)}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">{card.detail}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-md border border-[#1d4ed8]/20 bg-[#1d4ed8]/5 px-4 py-3 text-sm text-[#1e40af]">
              {t('admin.dashboard.statsRecent', {
                days: stats.recent.days,
                organizations: stats.recent.newOrganizations,
                events: stats.recent.newEvents,
                tournaments: stats.recent.newTournaments,
                persons: stats.recent.newGlobalPersons,
                matches: stats.recent.completedMatches,
              })}
            </div>
          </>
        ) : null}
      </section>

      <section>
        <h2 className="mb-4 text-xl font-bold text-[#0f172a]">{t('admin.dashboard.toolsTitle')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="group rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-[#1d4ed8]/40 hover:bg-[#1d4ed8]/5"
            >
              <div className="flex items-start gap-4">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[#0f172a]/10 bg-[#0f172a] text-xs font-bold text-[#f59e0b]"
                  aria-hidden="true"
                >
                  {section.badge}
                </span>
                <div>
                  <h3 className="text-base font-bold text-[#0f172a]">{t(section.titleKey)}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {t(section.descriptionKey)}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
