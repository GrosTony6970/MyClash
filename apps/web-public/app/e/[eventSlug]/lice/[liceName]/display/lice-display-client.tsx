'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { DisplayView } from '../../../match/[matchId]/display/display-view';

interface Props {
  apiUrl: string;
  eventSlug: string;
  liceName: string;
}

export function LiceDisplayClient({ apiUrl, eventSlug, liceName }: Props) {
  const { t } = useI18n();
  const [payload, setPayload] = useState<{
    match: unknown | null;
    penalties: unknown[];
    matchId: string | null;
    nextMatch: unknown | null;
  }>({ match: null, penalties: [], matchId: null, nextMatch: null });

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const currentRes = await fetch(
        `${apiUrl}/api/v1/events/${eventSlug}/lices/${encodeURIComponent(liceName)}/current`,
        { cache: 'no-store' },
      );
      if (!currentRes.ok) return;
      const current = (await currentRes.json()) as {
        current: { id: string } | null;
        queue: unknown[];
      };
      if (!current.current) {
        if (!cancelled) {
          setPayload({
            match: null,
            penalties: [],
            matchId: null,
            nextMatch: current.queue[0] ?? null,
          });
        }
        return;
      }
      const [matchRes, penaltiesRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/matches/${current.current.id}/display`, { cache: 'no-store' }),
        fetch(`${apiUrl}/api/v1/matches/${current.current.id}/penalties`, { cache: 'no-store' }),
      ]);
      if (!matchRes.ok || cancelled) return;
      setPayload({
        match: await matchRes.json(),
        penalties: penaltiesRes.ok ? await penaltiesRes.json() : [],
        matchId: current.current.id,
        nextMatch: current.queue[0] ?? null,
      });
    }

    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [apiUrl, eventSlug, liceName]);

  if (!payload.match || !payload.matchId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black p-8 text-center text-white">
        <p className="text-5xl font-black">{t('scoring.liveMatch.waitingForMatch')}</p>
      </main>
    );
  }

  return <DisplayView matchId={payload.matchId} eventSlug={eventSlug} />;
}
