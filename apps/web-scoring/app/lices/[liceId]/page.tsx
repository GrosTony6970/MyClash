'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScoringPad } from '../../../src/components/ScoringPad';
import { PenaltyPanel } from '../../../src/components/PenaltyPanel';
import MatchClock from '../../../src/components/MatchClock';
import type { ClockState } from '../../../src/components/MatchClock';
import { useI18n } from '../../../src/i18n/I18nProvider';
import type { TournamentScoringConfig } from '@myclash/types';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';

interface MatchInfo {
  id: string;
  matchNumberLabel: string;
  status: string;
  rulesetCode: string;
  rulesetVersion: string;
  redRegistrationId: string;
  blueRegistrationId: string;
  redScore: number;
  blueScore: number;
  redFighterName?: string;
  blueFighterName?: string;
  weapon?: string;
  tournamentId?: string;
  eventSlug?: string;
}

interface Props {
  params: Promise<{ liceId: string }>;
}

export default function LiceMatchPage({ params }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [liceId, setLiceId] = useState<string | null>(null);
  const [currentMatch, setCurrentMatch] = useState<MatchInfo | null>(null);
  const [loading, setLoading] = useState(true);
  // Initialize from browser API synchronously — avoids a flash of wrong state
  const [networkStatus, setNetworkStatus] = useState<'online' | 'offline'>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online',
  );

  // Resolve params
  useEffect(() => {
    void params.then(({ liceId: id }) => setLiceId(id));
  }, [params]);

  // Network status monitoring — only subscribe to changes, initial value set above
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

  // Fetch current match for this Lice
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
        const payload = (await res.json()) as {
          current: MatchInfo | null;
          event?: { slug?: string };
        };
        setCurrentMatch(
          payload.current ? { ...payload.current, eventSlug: payload.event?.slug } : null,
        );
      } catch {
        // Offline — show last cached state
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
    <main id="main-content" className="min-h-screen flex flex-col">
      {/* Network status bar */}
      <div
        className={`px-4 py-1 text-xs font-bold text-center ${
          networkStatus === 'online'
            ? 'bg-green-900 text-green-300'
            : 'bg-red-900 text-red-300 animate-pulse'
        }`}
      >
        {networkStatus === 'online'
          ? `● ${t('scoring.lice.online')}`
          : `● ${t('scoring.lice.offlineQueued')}`}
      </div>

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <button
          onClick={() => router.push('/lices')}
          className="text-gray-400 hover:text-white text-sm"
        >
          ← {t('scoring.lice.backToLices')}
        </button>
        <h1 className="font-bold text-lg">{t('scoring.lice.title', { liceId })}</h1>
        <div className="w-16" />
      </header>

      {/* Match content */}
      {currentMatch ? <MatchView match={currentMatch} apiUrl={apiUrl} /> : <NoMatchView />}
    </main>
  );
}

// ── Match view ────────────────────────────────────────────────────────────────

function MatchView({ match, apiUrl }: { match: MatchInfo; apiUrl: string }) {
  const { t } = useI18n();
  const publicAppUrl = process.env['NEXT_PUBLIC_PUBLIC_APP_URL'] ?? 'https://app.myclash.fr';
  const [nextSequence, setNextSequence] = useState(1);
  const [scoringConfig, setScoringConfig] =
    useState<TournamentScoringConfig>(DEFAULT_SCORING_CONFIG);
  const [clockState, setClockState] = useState<ClockState | null>(null);

  // Fetch scoring config for this tournament
  useEffect(() => {
    if (!match.tournamentId) return;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/tournaments/${match.tournamentId}/scoring-config`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) setScoringConfig((await res.json()) as TournamentScoringConfig);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [match.tournamentId, apiUrl]);

  return (
    <div className="flex-1 flex flex-col p-4 gap-4">
      {/* Match header */}
      <div className="text-center">
        <p className="text-gray-400 text-sm">{match.matchNumberLabel}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {t('scoring.lice.rulesetVersion', {
            code: match.rulesetCode,
            version: match.rulesetVersion,
          })}
          {match.weapon ? ` / ${match.weapon}` : ''}
        </p>
        {match.eventSlug && (
          <a
            href={`${publicAppUrl}/e/${match.eventSlug}/match/${match.id}/display`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex rounded-lg border border-gray-700 px-3 py-2 text-sm font-medium text-gray-200 hover:border-red-500 hover:text-white"
          >
            {t('scoring.lice.externalDisplay')}
          </a>
        )}
      </div>

      {/* Clock — must be halted before scoring */}
      <MatchClock matchId={match.id} apiUrl={apiUrl} onStateChange={setClockState} />

      {/* ScoringPad — scoreboard + buttons under each fighter */}
      <div className="flex-1">
        <ScoringPad
          matchId={match.id}
          nextSequence={nextSequence}
          apiUrl={apiUrl}
          redName={match.redFighterName ?? t('scoring.lice.red')}
          blueName={match.blueFighterName ?? t('scoring.lice.blue')}
          redScore={match.redScore}
          blueScore={match.blueScore}
          scoringEnabled={match.status === 'running' || match.status === 'halted'}
          config={scoringConfig}
          clockState={clockState}
          onExchangeRecorded={() => setNextSequence((n) => n + 1)}
        />
        <div className="mt-4">
          <PenaltyPanel
            matchId={match.id}
            nextSequence={nextSequence}
            apiUrl={apiUrl}
            redRegistrationId={match.redRegistrationId}
            blueRegistrationId={match.blueRegistrationId}
            redName={match.redFighterName ?? t('scoring.lice.red')}
            blueName={match.blueFighterName ?? t('scoring.lice.blue')}
            disabled={match.status !== 'running' && match.status !== 'halted'}
            onPenaltyRecorded={() => setNextSequence((n) => n + 1)}
          />
        </div>
      </div>
    </div>
  );
}

function NoMatchView() {
  const { t } = useI18n();
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="text-5xl mb-4">⏳</div>
      <h2 className="text-xl font-bold mb-2">{t('scoring.lice.noMatchTitle')}</h2>
      <p className="text-gray-400 text-sm">{t('scoring.lice.noMatchDescription')}</p>
    </div>
  );
}
