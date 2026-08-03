'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useI18n } from '../../../src/i18n/I18nProvider';
import { useScoringTheme } from '../../../src/theme/ThemeProvider';
import { ThemeSwitcher } from '../../../src/theme/ThemeSwitcher';
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
  const { chromeScope } = useScoringTheme();
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
      // Same scope as the loaded state below, or the screen changes surface
      // the moment the fetch lands.
      <main
        id="main-content"
        data-theme={chromeScope}
        className="flex min-h-screen items-center justify-center bg-background text-foreground"
      >
        <p className="text-muted">{t('scoring.lice.loadingMatch')}</p>
      </main>
    );
  }

  return (
    // Own data-theme — this is the app's chrome (see MatchHeader: "hybrid:
    // light chrome, dark scoring area"). Tokens inherit from <body>, so a
    // region that differs from the pad needs its own scope to override with.
    <main
      id="main-content"
      data-theme={chromeScope}
      className="min-h-screen flex flex-col bg-background text-foreground"
    >
      {/* Network status */}
      <div
        className={`px-4 py-1 text-xs font-bold text-center ${
          networkStatus === 'online'
            ? 'bg-success/15 text-success'
            : 'bg-muted/20 text-muted animate-pulse'
        }`}
      >
        {networkStatus === 'online'
          ? `● ${t('scoring.lice.online')}`
          : `● ${t('scoring.lice.offlineQueued')}`}
      </div>

      {/* Light chrome header */}
      <header className="border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/lices"
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground-secondary hover:border-muted hover:bg-background"
          >
            ← {t('scoring.lice.yourLices')}
          </Link>
          <h1 className="text-base font-bold uppercase tracking-wide">
            {t('scoring.lice.title', { liceName: data?.liceName ?? '—' })}
          </h1>
          <div className="flex w-20 justify-end">
            <ThemeSwitcher />
          </div>
        </div>
      </header>

      <div className="flex-1 p-4 max-w-3xl w-full mx-auto">
        {data?.current && (
          <section className="mb-6">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted">
              {t('scoring.lice.live')}
            </h2>
            <MatchCard match={data.current} />
          </section>
        )}

        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted">
            {t('scoring.lice.nextMatchLabel')}
          </h2>
          {data?.queue.length === 0 && (
            <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted">
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
      className={`block rounded-xl border bg-surface px-4 py-3 transition-colors hover:border-muted hover:bg-background ${
        isLive ? 'border-warning bg-warning/10' : 'border-border'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted">
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
          {time && <p className="font-mono text-sm tabular-nums text-muted">{time}</p>}
          {isLive && (
            <span className="mt-1 inline-block rounded-full bg-warning px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-warning-foreground">
              LIVE
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
