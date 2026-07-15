'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AdminPageHeader, FoilMark, MetricCard, StatsGrid } from '@myclash/ui';
import { localeToBcp47 } from '@myclash/time';
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
  clubs: { total: number };
  leagues: { total: number };
  platformUsers: { total: number };
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('fr-FR').format(value);
}

export default function SuperAdminDashboardPage() {
  const { t, locale } = useI18n();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  // AI summary is not part of dashboard-stats, so it fetches separately. It
  // stays null (section hidden) until at least one call succeeds — we never
  // show zeros on a failed load.
  const [aiSummary, setAiSummary] = useState<{ spent: number; ceiling: number | null } | null>(
    null,
  );

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

  useEffect(() => {
    const controller = new AbortController();
    const now = new Date();
    // Month-to-date window (UTC) so spend is comparable to the monthly ceiling;
    // a bare summary call returns all-time totals.
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    Promise.all([
      fetch(`${apiUrl}/api/v1/admin/ai-usage/summary?from=${encodeURIComponent(from)}`, {
        credentials: 'include',
        signal: controller.signal,
      }).then((res) => (res.ok ? (res.json() as Promise<{ total: { costEur: number } }>) : null)),
      fetch(`${apiUrl}/api/v1/admin/ai-settings`, {
        credentials: 'include',
        signal: controller.signal,
      }).then((res) =>
        res.ok ? (res.json() as Promise<{ monthlyBudgetEur: number | null }>) : null,
      ),
    ])
      .then(([usage, cfg]) => {
        if (usage || cfg) {
          setAiSummary({
            spent: usage?.total.costEur ?? 0,
            ceiling: cfg?.monthlyBudgetEur ?? null,
          });
        }
      })
      .catch(() => {
        // Network error / abort — leave the AI section hidden.
      });
    return () => controller.abort();
  }, [apiUrl]);

  const metricSections = useMemo(() => {
    if (!stats) return [];
    return [
      {
        headingKey: 'admin.dashboard.section.platform',
        cards: [
          {
            label: t('admin.dashboard.stats.organizations'),
            value: stats.organizations.total,
            detail: t('admin.dashboard.stats.organizationsDetail', {
              active: stats.organizations.active,
              suspended: stats.organizations.suspended,
            }),
          },
          {
            label: t('admin.dashboard.stats.clubs'),
            value: stats.clubs.total,
            detail: t('admin.dashboard.stats.clubsDetail'),
          },
          {
            label: t('admin.dashboard.stats.leagues'),
            value: stats.leagues.total,
            detail: t('admin.dashboard.stats.leaguesDetail'),
          },
          {
            label: t('admin.dashboard.stats.platformUsers'),
            value: stats.platformUsers.total,
            detail: t('admin.dashboard.stats.platformUsersDetail'),
          },
        ],
      },
      {
        headingKey: 'admin.dashboard.section.content',
        cards: [
          {
            label: t('admin.dashboard.stats.eventsLive'),
            value: stats.events.publishedOrRunning,
            detail: t('admin.dashboard.stats.eventsLiveDetail', { total: stats.events.total }),
          },
          {
            label: t('admin.dashboard.stats.eventsCompleted'),
            value: stats.events.completed,
            detail: t('admin.dashboard.stats.eventsCompletedDetail', { draft: stats.events.draft }),
          },
          {
            label: t('admin.dashboard.stats.tournamentsCreated'),
            value: stats.tournaments.total,
            detail: t('admin.dashboard.stats.tournamentsCreatedDetail', {
              active: stats.tournaments.active,
            }),
          },
          {
            label: t('admin.dashboard.stats.tournamentsCompleted'),
            value: stats.tournaments.completed,
            detail: t('admin.dashboard.stats.tournamentsCompletedDetail', {
              draft: stats.tournaments.draft,
            }),
          },
          {
            label: t('admin.dashboard.stats.fighters'),
            value: stats.people.fighters,
            detail: t('admin.dashboard.stats.fightersDetail', {
              global: stats.people.globalPersons,
            }),
          },
        ],
      },
      {
        headingKey: 'admin.dashboard.section.activity',
        cards: [
          {
            label: t('admin.dashboard.stats.registrations'),
            value: stats.activity.registrations,
            detail: t('admin.dashboard.stats.registrationsDetail', {
              persons: stats.people.eventPersons,
            }),
          },
          {
            label: t('admin.dashboard.stats.completedMatches'),
            value: stats.activity.completedMatches,
            detail: t('admin.dashboard.stats.completedMatchesDetail', {
              total: stats.activity.matches,
            }),
          },
          {
            label: t('admin.dashboard.stats.exchanges'),
            value: stats.activity.exchanges,
            detail: t('admin.dashboard.stats.exchangesDetail', {
              claimed: stats.people.claimedProfiles,
            }),
          },
        ],
      },
    ];
  }, [stats, t]);

  return (
    <main id="main-content" className="mx-auto max-w-[110rem] px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('admin.dashboard.eyebrow')}
        title={t('admin.dashboard.title')}
        subtitle={t('admin.dashboard.description')}
        actions={
          stats ? (
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              {t('admin.dashboard.statsUpdated', {
                date: new Date(stats.generatedAt).toLocaleString(localeToBcp47(locale)),
              })}
            </p>
          ) : null
        }
      />

      <section className="mb-12">
        {loadingStats ? (
          <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted">
            {t('admin.dashboard.statsLoading')}
          </p>
        ) : statsError ? (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {statsError}
          </p>
        ) : stats ? (
          <>
            {metricSections.map((section, sectionIdx) => (
              <div key={section.headingKey} className={sectionIdx === 0 ? '' : 'mt-10'}>
                <div className="mb-4 flex items-center gap-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-accent">
                    {t(section.headingKey)}
                  </h2>
                  <FoilMark className="text-muted" width={32} />
                </div>
                <StatsGrid cols={3}>
                  {section.cards.map((card, cardIdx) => (
                    <MetricCard
                      key={card.label}
                      label={card.label}
                      value={formatNumber(card.value)}
                      detail={card.detail}
                      className="metric-card"
                      style={{ animationDelay: `${(sectionIdx * 4 + cardIdx) * 60}ms` }}
                    />
                  ))}
                </StatsGrid>
              </div>
            ))}
            <div className="mt-10 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
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

      {aiSummary && (
        <section className="mb-12">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-accent">
              {t('admin.dashboard.section.ai')}
            </h2>
            <FoilMark className="text-muted" width={32} />
          </div>
          <StatsGrid cols={3}>
            <MetricCard
              label={t('admin.dashboard.stats.aiSpend')}
              value={`€${aiSummary.spent.toFixed(2)}`}
            />
            <MetricCard
              label={t('admin.dashboard.stats.aiBudgetCeiling')}
              value={
                aiSummary.ceiling == null
                  ? t('admin.aiSettings.keys.unlimited')
                  : `€${aiSummary.ceiling.toFixed(2)}`
              }
            />
            <MetricCard
              label={t('admin.dashboard.stats.aiUtilization')}
              value={
                aiSummary.ceiling && aiSummary.ceiling > 0
                  ? `${Math.round((aiSummary.spent / aiSummary.ceiling) * 100)}%`
                  : '—'
              }
            />
          </StatsGrid>
          <div className="mt-4">
            <Link href="/admin/ai" className="text-sm font-semibold text-accent hover:underline">
              {t('admin.dashboard.manageAi')}
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
