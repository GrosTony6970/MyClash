'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../src/i18n/I18nProvider';

interface OrgEvent {
  id: string;
  slug: string;
  name: string;
  location: string | null;
  startDate: string;
  endDate: string;
  status: string;
  tournamentCount: number;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  published: 'bg-blue-50 text-blue-700 border-blue-100',
  running: 'bg-green-50 text-green-700 border-green-100',
  completed: 'bg-slate-100 text-slate-500 border-slate-200',
  archived: 'bg-slate-900 text-slate-200 border-slate-800',
};

export default function OrgDashboardPage() {
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [orgName, setOrgName] = useState<string>(slug);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const org = (await res.json()) as { id: string; name: string };
        setOrgName(org.name);

        return fetch(`${apiUrl}/api/v1/events?organizationId=${org.id}&status=all`, {
          credentials: 'include',
          signal: controller.signal,
        });
      })
      .then(async (res) => {
        if (!res?.ok) return;
        setEvents((await res.json()) as OrgEvent[]);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(t('organizer.dashboard.failedEvents'));
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [slug, apiUrl, t]);

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
          href={`/org/${slug}/events/new`}
          className="inline-flex w-fit items-center rounded-md bg-[#dc2626] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
        >
          {t('organizer.dashboard.newEvent')}
        </Link>
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-[#1d4ed8]" />
          {t('organizer.dashboard.loadingEvents')}
        </div>
      )}

      {!loading && events.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-20 text-center shadow-sm">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded border border-slate-200 bg-slate-50 text-xs font-bold text-[#f59e0b]">
            EV
          </span>
          <h2 className="mb-2 text-xl font-bold text-[#0f172a]">
            {t('organizer.dashboard.emptyTitle')}
          </h2>
          <p className="mb-6 max-w-sm text-sm text-slate-500">
            {t('organizer.dashboard.emptyDescription')}
          </p>
          <Link
            href={`/org/${slug}/events/new`}
            className="rounded-md bg-[#dc2626] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
          >
            {t('organizer.dashboard.newEvent')}
          </Link>
        </div>
      )}

      {!loading && events.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          {events.map((ev) => (
            <Link
              key={ev.id}
              href={`/org/${slug}/events/${ev.id}`}
              className="block rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm transition-all hover:border-[#1d4ed8]/40 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-bold text-[#0f172a]">{ev.name}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {ev.location ?? t('organizer.dashboard.noLocation')}
                    {' - '}
                    {new Date(ev.startDate).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {ev.startDate !== ev.endDate &&
                      ` - ${new Date(ev.endDate).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'short',
                      })}`}
                  </p>
                  {ev.tournamentCount > 0 && (
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                      {t(
                        ev.tournamentCount === 1
                          ? 'organizer.dashboard.eventCount'
                          : 'organizer.dashboard.eventCountPlural',
                        { count: ev.tournamentCount },
                      )}
                    </p>
                  )}
                </div>
                <span
                  className={[
                    'flex-shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                    STATUS_COLORS[ev.status] ?? STATUS_COLORS['draft']!,
                  ].join(' ')}
                >
                  {ev.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
