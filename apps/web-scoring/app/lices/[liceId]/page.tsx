'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useI18n } from '../../../src/i18n/I18nProvider';
import { getApiUrl } from '../../../src/lib/api-url';
import { sideStyle } from '@myclash/ui';
import type { TournamentScoringConfig } from '@myclash/types';

interface Props {
  params: Promise<{ liceId: string }>;
}

interface QueueMatch {
  id: string;
  status: string;
  matchNumberLabel?: string | null;
  roundCode?: string | null;
  redFighterName?: string | null;
  blueFighterName?: string | null;
  scheduledAt?: string | null;
  scoringConfig?: TournamentScoringConfig | null;
}

interface LiceQueueResponse {
  liceId: string;
  liceName: string;
  current: QueueMatch | null;
  queue: QueueMatch[];
}

/**
 * Per-lice match list. Replaces the old "show current match"
 * single-view with the full queue (current + upcoming) so the
 * operator can navigate to any match on this lice.
 *
 * Routes:
 *   - `/lices` → lice picker
 *   - `/lices/[liceId]` → THIS page (match list for that lice)
 *   - `/matches/[matchId]` → scoreboard (linked from this page)
 */
export default function LiceMatchListPage({ params }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const apiUrl = getApiUrl();

  const [liceId, setLiceId] = useState<string | null>(null);
  const [data, setData] = useState<LiceQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [networkStatus, setNetworkStatus] = useState<'online' | 'offline'>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online',
  );

  useEffect(() => {
    void params.then(({ liceId: id }) => setLiceId(id));
  }, [params]);

  useEffect(() => {
    const handleOnline = () => setNetworkStatus('online');
    const handleOffline = () => setNetworkStatus('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!liceId) return;
    void (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/staff/lices/${liceId}/current-match`, {
          credentials: 'include',
        });
        if (!res.ok) {
          router.replace('/login');
          return;
        }
        const body = (await res.json()) as LiceQueueResponse;
        setData(body);
      } catch {
        // Offline — leave previous data in place
      } finally {
        setLoading(false);
      }
    })();
  }, [liceId, apiUrl, router]);

  if (loading) {
    return (
      <main id="main-content" className="flex min-h-screen items-center justify-center">
        <p className="text-gray-400">{t('scoring.lice.loadingMatch')}</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-screen flex flex-col bg-stone-50 text-slate-900">
      {/* Network status */}
      <div
        className={`px-4 py-1 text-xs font-bold text-center ${
          networkStatus === 'online'
            ? 'bg-green-100 text-green-700'
            : 'bg-red-100 text-red-700 animate-pulse'
        }`}
      >
        {networkStatus === 'online'
          ? `● ${t('scoring.lice.online')}`
          : `● ${t('scoring.lice.offlineQueued')}`}
      </div>

      {/* Light chrome header */}
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/lices"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-500 hover:bg-slate-50"
          >
            ← {t('scoring.lice.yourLices')}
          </Link>
          <h1 className="text-base font-bold uppercase tracking-wide">
            {t('scoring.lice.title', { liceName: data?.liceName ?? '—' })}
          </h1>
          <div className="w-20" />
        </div>
      </header>

      <div className="flex-1 p-4 max-w-3xl w-full mx-auto">
        {data?.current && (
          <section className="mb-6">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">
              {t('scoring.lice.live')}
            </h2>
            <MatchCard match={data.current} />
          </section>
        )}

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">
            {t('scoring.lice.nextMatchLabel')}
          </h2>
          {data?.queue.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
              {t('scoring.lice.noNextMatch')}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {data?.queue.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function MatchCard({ match }: { match: QueueMatch }) {
  const config = match.scoringConfig ?? null;
  const redStyle = sideStyle(config, 'red');
  const blueStyle = sideStyle(config, 'blue');
  const time = match.scheduledAt
    ? new Date(match.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const isLive = match.status === 'running' || match.status === 'paused';

  return (
    <Link
      href={`/matches/${match.id}`}
      className={`block rounded-xl border bg-white px-4 py-3 transition-colors hover:border-slate-500 hover:bg-slate-50 ${
        isLive ? 'border-amber-400 bg-amber-50' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-slate-500">
            {match.roundCode ?? match.matchNumberLabel ?? '—'}
          </p>
          <p className="mt-1 text-base font-semibold leading-tight">
            <span style={{ color: redStyle.border }}>● </span>
            {match.redFighterName ?? '—'}
          </p>
          <p className="text-base font-semibold leading-tight">
            <span style={{ color: blueStyle.border }}>● </span>
            {match.blueFighterName ?? '—'}
          </p>
        </div>
        <div className="text-right">
          {time && <p className="font-mono text-sm tabular-nums text-slate-500">{time}</p>}
          {isLive && (
            <span className="mt-1 inline-block rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">
              LIVE
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
