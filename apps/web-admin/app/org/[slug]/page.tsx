'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../src/i18n/I18nProvider';

interface DashboardStats {
  eventsTotal: number;
  upcomingEvents: number;
  tournamentsTotal: number;
  fighterParticipations: number;
  refereeParticipations: number;
}

const EMPTY_STATS: DashboardStats = {
  eventsTotal: 0,
  upcomingEvents: 0,
  tournamentsTotal: 0,
  fighterParticipations: 0,
  refereeParticipations: 0,
};

export default function OrgDashboardPage() {
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [orgName, setOrgName] = useState<string>(slug);
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('organizer.dashboard.failedStats'));
        const org = (await res.json()) as { id: string; name: string };
        setOrgName(org.name);
        return fetch(`${apiUrl}/api/v1/organizations/${org.id}/dashboard-stats`, {
          credentials: 'include',
          signal: controller.signal,
        });
      })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('organizer.dashboard.failedStats'));
        setStats((await res.json()) as DashboardStats);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('organizer.dashboard.failedStats'));
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [slug, apiUrl, t]);

  const cards = [
    {
      label: t('organizer.dashboard.metrics.eventsCreated'),
      value: stats.eventsTotal,
      detail: t('organizer.dashboard.metrics.eventsCreatedDetail'),
    },
    {
      label: t('organizer.dashboard.metrics.upcomingEvents'),
      value: stats.upcomingEvents,
      detail: t('organizer.dashboard.metrics.upcomingEventsDetail'),
    },
    {
      label: t('organizer.dashboard.metrics.tournaments'),
      value: stats.tournamentsTotal,
      detail: t('organizer.dashboard.metrics.tournamentsDetail'),
    },
    {
      label: t('organizer.dashboard.metrics.fighters'),
      value: stats.fighterParticipations,
      detail: t('organizer.dashboard.metrics.fightersDetail'),
    },
    {
      label: t('organizer.dashboard.metrics.referees'),
      value: stats.refereeParticipations,
      detail: t('organizer.dashboard.metrics.refereesDetail'),
    },
  ];

  return (
    <main className="p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1d4ed8]">
            {t('organizer.shell.eyebrow')}
          </p>
          <h1 className="mt-2 text-3xl font-bold text-[#0f172a]">{orgName}</h1>
          <p className="mt-1 font-mono text-sm text-slate-500">{slug}</p>
        </div>
        <Link
          href={`/org/${slug}/events`}
          className="inline-flex w-fit items-center rounded-md bg-[#dc2626] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
        >
          {t('organizer.dashboard.manageEvents')}
        </Link>
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="mb-6 flex items-center gap-2 text-sm text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-[#1d4ed8]" />
          {t('organizer.dashboard.loadingStats')}
        </div>
      )}

      <section className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => (
          <article
            key={card.label}
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              {card.label}
            </p>
            <p className="mt-4 text-3xl font-bold text-[#0f172a]">{card.value}</p>
            <p className="mt-1 text-sm text-slate-500">{card.detail}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Link
          href={`/org/${slug}/events`}
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-[#1d4ed8]/40 hover:shadow-md"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded border border-slate-200 bg-slate-50 text-xs font-bold text-[#f59e0b]">
            EV
          </span>
          <h2 className="mt-4 font-bold text-[#0f172a]">
            {t('organizer.dashboard.eventsCardTitle')}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {t('organizer.dashboard.eventsCardDescription')}
          </p>
        </Link>
        <Link
          href={`/org/${slug}/settings/ai`}
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-[#1d4ed8]/40 hover:shadow-md"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded border border-slate-200 bg-slate-50 text-xs font-bold text-[#f59e0b]">
            AI
          </span>
          <h2 className="mt-4 font-bold text-[#0f172a]">{t('organizer.dashboard.aiCardTitle')}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {t('organizer.dashboard.aiCardDescription')}
          </p>
        </Link>
        <Link
          href={`/org/${slug}/settings/compensation`}
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-[#1d4ed8]/40 hover:shadow-md"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded border border-slate-200 bg-slate-50 text-xs font-bold text-[#f59e0b]">
            C
          </span>
          <h2 className="mt-4 font-bold text-[#0f172a]">
            {t('organizer.dashboard.compensationCardTitle')}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {t('organizer.dashboard.compensationCardDescription')}
          </p>
        </Link>
      </section>
    </main>
  );
}
