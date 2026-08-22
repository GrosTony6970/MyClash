'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useI18n } from '@myclash/next-i18n/client';
import { EventStatBand } from '../../../../../../src/components/statistics/EventStatBand';
import { TournamentStatSection } from '../../../../../../src/components/statistics/TournamentStatSection';
import { WeaponPointStatsSection } from '../../../../../../src/components/statistics/WeaponPointStats';
import { RefereeWorkloadTable } from '../../../../../../src/components/statistics/RefereeWorkloadTable';
import type { EventStatistics } from '../../../../../../src/components/statistics/types';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

export default function EventStatisticsPage() {
  const { eventId } = useParams<{ slug: string; eventId: string }>();
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();

  const [data, setData] = useState<EventStatistics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // setState only inside the async callbacks (never synchronously in the
    // effect body) to satisfy react-hooks/set-state-in-effect.
    const controller = new AbortController();
    void apiRequest<EventStatistics>(apiUrl, `/api/v1/events/${eventId}/statistics`, {
      signal: controller.signal,
    }).then((r) => {
      if (r.ok) {
        setData(r.data);
        setError(null);
        return;
      }
      // No message is the unmount.
      const message = failureMessage(r, t, t('organizer.eventStats.loadError'));
      if (message) setError(message);
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
