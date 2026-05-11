'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScoringPad } from '../../../src/components/ScoringPad';
import { PenaltyPanel } from '../../../src/components/PenaltyPanel';
import { ForfeitPanel } from '../../../src/components/ForfeitPanel';
import MatchClock from '../../../src/components/MatchClock';
import type { ClockState } from '../../../src/components/MatchClock';
import { useI18n } from '../../../src/i18n/I18nProvider';
import type { MatchFormatConfig, TournamentScoringConfig } from '@myclash/types';
import { DEFAULT_MATCH_FORMAT_CONFIG, DEFAULT_SCORING_CONFIG } from '@myclash/types';

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
  phaseType?: 'pool' | 'single_elim' | 'double_elim' | 'swiss' | null;
  sideOrder?: 'red_left' | 'blue_left';
  lockedAt?: string | null;
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
  const [refreshKey, setRefreshKey] = useState(0);
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
  }, [liceId, apiUrl, router, refreshKey]);

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
      {currentMatch ? (
        <MatchView
          match={currentMatch}
          apiUrl={apiUrl}
          networkStatus={networkStatus}
          onRefresh={() => setRefreshKey((key) => key + 1)}
        />
      ) : (
        <NoMatchView />
      )}
    </main>
  );
}

// ── Match view ────────────────────────────────────────────────────────────────

function MatchView({
  match,
  apiUrl,
  networkStatus,
  onRefresh,
}: {
  match: MatchInfo;
  apiUrl: string;
  networkStatus: 'online' | 'offline';
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const publicAppUrl = process.env['NEXT_PUBLIC_PUBLIC_APP_URL'] ?? 'https://app.myclash.fr';
  const [nextSequence, setNextSequence] = useState(1);
  const [scoringConfig, setScoringConfig] =
    useState<TournamentScoringConfig>(DEFAULT_SCORING_CONFIG);
  const [matchFormat, setMatchFormat] = useState<MatchFormatConfig>(DEFAULT_MATCH_FORMAT_CONFIG);
  const [clockState, setClockState] = useState<ClockState | null>(null);

  // Fetch scoring config for this tournament
  useEffect(() => {
    if (!match.tournamentId) return;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/tournaments/${match.tournamentId}/match-config`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) {
          const config = (await res.json()) as {
            scoringConfig: TournamentScoringConfig;
            matchFormat: MatchFormatConfig;
          };
          setScoringConfig(config.scoringConfig);
          setMatchFormat(config.matchFormat);
        }
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
      {match.lockedAt && (
        <div className="rounded-xl border border-yellow-700 bg-yellow-950 px-4 py-3 text-center text-sm font-bold text-yellow-100">
          {t('scoring.corrections.matchLocked')}
        </div>
      )}

      <MatchClock
        matchId={match.id}
        apiUrl={apiUrl}
        matchFormat={matchFormat}
        phaseType={match.phaseType ?? undefined}
        matchNumberLabel={match.matchNumberLabel}
        disabled={Boolean(match.lockedAt)}
        onStateChange={setClockState}
      />

      <CorrectionTools
        matchId={match.id}
        apiUrl={apiUrl}
        online={networkStatus === 'online'}
        locked={Boolean(match.lockedAt)}
        onDone={onRefresh}
      />

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
          scoringEnabled={
            (match.status === 'running' || match.status === 'halted') && !match.lockedAt
          }
          config={scoringConfig}
          matchFormat={matchFormat}
          phaseType={match.phaseType ?? undefined}
          matchNumberLabel={match.matchNumberLabel}
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
            disabled={(match.status !== 'running' && match.status !== 'halted') || !!match.lockedAt}
            onPenaltyRecorded={() => setNextSequence((n) => n + 1)}
          />
        </div>
        <div className="mt-4">
          <ForfeitPanel
            matchId={match.id}
            apiUrl={apiUrl}
            redRegistrationId={match.redRegistrationId}
            blueRegistrationId={match.blueRegistrationId}
            redName={match.redFighterName ?? t('scoring.lice.red')}
            blueName={match.blueFighterName ?? t('scoring.lice.blue')}
            disabled={(match.status !== 'running' && match.status !== 'halted') || !!match.lockedAt}
            onForfeitRecorded={onRefresh}
          />
        </div>
      </div>
    </div>
  );
}

interface ExchangeSummary {
  id: string;
  sequence: number;
  type: string;
  voided: boolean;
}

function CorrectionTools({
  matchId,
  apiUrl,
  online,
  locked,
  onDone,
}: {
  matchId: string;
  apiUrl: string;
  online: boolean;
  locked: boolean;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetText, setResetText] = useState('');
  const [reason, setReason] = useState('');
  const [adjustSeconds, setAdjustSeconds] = useState(10);
  const [exchanges, setExchanges] = useState<ExchangeSummary[]>([]);
  const [selectedExchangeId, setSelectedExchangeId] = useState('');

  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/matches/${matchId}/exchanges`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) {
          const rows = ((await res.json()) as ExchangeSummary[]).filter((row) => !row.voided);
          setExchanges(rows);
          setSelectedExchangeId(rows.at(-1)?.id ?? '');
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiUrl, matchId, online]);

  const disabled = busy || !online || locked;

  async function post(path: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? t('scoring.corrections.actionFailed'));
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scoring.corrections.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function editSelectedExchange() {
    if (!selectedExchangeId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/exchanges/${selectedExchangeId}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          reason: reason || t('scoring.corrections.defaultReason'),
          clientUuid: crypto.randomUUID(),
          sequence: 0,
          type: 'no_exchange',
          occurredAt: new Date().toISOString(),
          noExchangeReason: 'other',
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? t('scoring.corrections.actionFailed'));
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scoring.corrections.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-950 p-4 text-gray-100">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-200">
          {t('scoring.corrections.title')}
        </h2>
        {!online && (
          <span className="text-xs text-red-300">{t('scoring.corrections.onlineOnly')}</span>
        )}
        {locked && (
          <span className="text-xs text-yellow-300">{t('scoring.corrections.locked')}</span>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-900 px-3 py-2 text-xs text-red-100">{error}</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            void post(`/api/v1/matches/${matchId}/exchanges/clear-last`, {
              reason: reason || t('scoring.corrections.defaultReason'),
            })
          }
          className="rounded-lg border border-gray-700 px-3 py-2 text-sm font-bold disabled:opacity-40"
        >
          {t('scoring.corrections.clearLastExchange')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void post(`/api/v1/matches/${matchId}/swap-fighter-color`)}
          className="rounded-lg border border-gray-700 px-3 py-2 text-sm font-bold disabled:opacity-40"
        >
          {t('scoring.corrections.swapColor')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void post(`/api/v1/matches/${matchId}/swap-fighter-side`)}
          className="rounded-lg border border-gray-700 px-3 py-2 text-sm font-bold disabled:opacity-40"
        >
          {t('scoring.corrections.swapSide')}
        </button>
        <button
          type="button"
          disabled={disabled || resetText !== 'RESET MATCH'}
          onClick={() =>
            void post(`/api/v1/matches/${matchId}/reset`, {
              confirmation: resetText,
              reason: reason || t('scoring.corrections.defaultReason'),
            })
          }
          className="rounded-lg border border-red-700 px-3 py-2 text-sm font-bold text-red-200 disabled:opacity-40"
        >
          {t('scoring.corrections.resetMatch')}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2">
        <input
          type="number"
          min={1}
          value={adjustSeconds}
          onChange={(event) => setAdjustSeconds(parseInt(event.target.value, 10) || 1)}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
          aria-label={t('scoring.corrections.adjustSeconds')}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            void post(`/api/v1/matches/${matchId}/clock/adjust`, {
              adjustmentMs: adjustSeconds * 1000,
              reason: reason || t('scoring.corrections.defaultReason'),
            })
          }
          className="rounded-lg border border-gray-700 px-3 py-2 text-sm font-bold disabled:opacity-40"
        >
          {t('scoring.corrections.addTime')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            void post(`/api/v1/matches/${matchId}/clock/adjust`, {
              adjustmentMs: -adjustSeconds * 1000,
              reason: reason || t('scoring.corrections.defaultReason'),
            })
          }
          className="rounded-lg border border-gray-700 px-3 py-2 text-sm font-bold disabled:opacity-40"
        >
          {t('scoring.corrections.subtractTime')}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <select
          value={selectedExchangeId}
          onChange={(event) => setSelectedExchangeId(event.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
        >
          <option value="">{t('scoring.corrections.selectExchange')}</option>
          {exchanges.map((exchange) => (
            <option key={exchange.id} value={exchange.id}>
              #{exchange.sequence} {exchange.type}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled || !selectedExchangeId}
          onClick={() => void editSelectedExchange()}
          className="rounded-lg border border-gray-700 px-3 py-2 text-sm font-bold disabled:opacity-40"
        >
          {t('scoring.corrections.editAsNoExchange')}
        </button>
      </div>

      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={t('scoring.corrections.reason')}
        aria-label={t('scoring.corrections.reason')}
        className="mt-3 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
      />
      <input
        value={resetText}
        onChange={(event) => setResetText(event.target.value)}
        placeholder={t('scoring.corrections.resetConfirmation')}
        aria-label={t('scoring.corrections.resetConfirmation')}
        className="mt-2 w-full rounded-lg border border-red-900 bg-gray-900 px-3 py-2 text-sm"
      />
    </section>
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
