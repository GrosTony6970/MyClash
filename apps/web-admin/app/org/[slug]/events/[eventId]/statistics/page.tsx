'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { EventStatBand } from '../../../../../../src/components/statistics/EventStatBand';
import { TournamentStatSection } from '../../../../../../src/components/statistics/TournamentStatSection';
import { WeaponPointStatsSection } from '../../../../../../src/components/statistics/WeaponPointStats';
import { RefereeWorkloadTable } from '../../../../../../src/components/statistics/RefereeWorkloadTable';
import type { EventStatistics } from '../../../../../../src/components/statistics/types';

export default function EventStatisticsPage() {
  const { eventId } = useParams<{ slug: string; eventId: string }>();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [data, setData] = useState<EventStatistics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // setState only inside the async callbacks (never synchronously in the
    // effect body) to satisfy react-hooks/set-state-in-effect.
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}/statistics`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('organizer.eventStats.loadError'));
        setData((await res.json()) as EventStatistics);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('organizer.eventStats.loadError'));
      });
    return () => controller.abort();
  }, [eventId, apiUrl, t]);

  const loading = data === null && error === null;

  return (
    <main className="mx-auto max-w-[110rem] p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-medium tracking-tight text-foreground">
          {t('organizer.eventStats.title')}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('organizer.eventStats.subtitle')}</p>
      </header>

      {error ? (
        <div className="mb-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-muted">{t('organizer.eventStats.tournament.loadingDetail')}</p>
      ) : data ? (
        <div className="space-y-8">
          <EventStatBand event={data.event} t={t} />

          <WeaponPointStatsSection breakdown={data.weaponBreakdown} t={t} />

          {data.tournaments.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
              {t('organizer.eventStats.empty')}
            </p>
          ) : (
            <div className="space-y-3">
              {data.tournaments.map((tournament) => (
                <TournamentStatSection
                  key={tournament.id}
                  summary={tournament}
                  eventId={eventId}
                  apiUrl={apiUrl}
                  t={t}
                />
              ))}
            </div>
          )}

          <RefereeWorkloadTable referees={data.referees} t={t} />
        </div>
      ) : null}
    </main>
  );
}
