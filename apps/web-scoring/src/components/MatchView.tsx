'use client';

import { useCallback, useEffect, useState } from 'react';
import { ForfeitPanel } from './ForfeitPanel';
import { MatchHeader } from './MatchHeader';
import { ScoringColumn } from './ScoringColumn';
import { ScoringCenterControls } from './ScoringCenterControls';
import { MatchCorrectionsDrawer } from './MatchCorrectionsDrawer';
import { useI18n } from '../i18n/I18nProvider';
import { useScoringSubmit } from '../hooks/useScoringSubmit';
import type { ClockState } from './MatchClock';
import type { MatchFormatConfig, TournamentScoringConfig } from '@myclash/types';
import { DEFAULT_MATCH_FORMAT_CONFIG, DEFAULT_SCORING_CONFIG } from '@myclash/types';
import { remainingClockMs } from './ScoringPad';

export interface MatchInfo {
  id: string;
  matchNumberLabel: string;
  /** Round code computed server-side (e.g. LSW-P1-M3). Empty for older matches. */
  roundCode?: string;
  status: string;
  rulesetCode: string;
  rulesetVersion: string;
  redRegistrationId: string;
  blueRegistrationId: string;
  redScore: number;
  blueScore: number;
  redFighterName?: string;
  blueFighterName?: string;
  redClub?: string | null;
  blueClub?: string | null;
  weapon?: string;
  tournamentId?: string;
  eventSlug?: string;
  phaseType?: 'pool' | 'single_elim' | 'double_elim' | 'swiss' | null;
  sideOrder?: 'red_left' | 'blue_left';
  lockedAt?: string | null;
  /** Set by page.tsx from the GET /matches/:id row so the header
   *  can build its back-link href and fetch the lice queue. */
  liceId?: string | null;
}

export interface MatchViewProps {
  match: MatchInfo;
  apiUrl: string;
  networkStatus: 'online' | 'offline';
  onRefresh: () => void;
  externalDisplayUrl?: string | null;
  /** Back-link target (admin return URL); falls back to the lice queue. */
  backHref?: string | null;
  /** Builds in-scoring match hrefs (prev/next tiles) with the /scoring
   *  prefix + preserved query. Defaults to a bare /matches/[id]. */
  buildMatchHref?: (id: string) => string;
}

export function MatchView({
  match,
  apiUrl,
  networkStatus,
  onRefresh,
  externalDisplayUrl,
  backHref,
  buildMatchHref,
}: MatchViewProps) {
  const { t } = useI18n();
  const [nextSequence, setNextSequence] = useState(1);
  const [scoringConfig, setScoringConfig] =
    useState<TournamentScoringConfig>(DEFAULT_SCORING_CONFIG);
  const [matchFormat, setMatchFormat] = useState<MatchFormatConfig>(DEFAULT_MATCH_FORMAT_CONFIG);
  const [clockState, setClockState] = useState<ClockState | null>(null);
  const [clockLoading, setClockLoading] = useState(false);
  const [clockError, setClockError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  // Fetch initial clock state
  const fetchClockState = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/matches/${match.id}/clock`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const state = (await res.json()) as ClockState;
      setClockState(state);
    } catch (err) {
      setClockError(err instanceof Error ? err.message : t('scoring.clock.loadFailed'));
    }
  }, [apiUrl, match.id, t]);

  useEffect(() => {
    void fetchClockState();
  }, [fetchClockState, refreshKey]);

  // Clock state machine: POST + refresh
  const onClockAction = useCallback(
    async (action: 'start' | 'halt' | 'resume' | 'end' | 'reopen' | 'reset_clock') => {
      setClockLoading(true);
      setClockError(null);
      try {
        const res = await fetch(`${apiUrl}/api/v1/matches/${match.id}/clock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? t('scoring.clock.actionFailed'));
        }
        const newState = (await res.json()) as ClockState;
        setClockState(newState);
        // Bump the parent refresh so match.status updates (which gates
        // the scoring buttons + penalty picker).
        onRefresh();
      } catch (err) {
        setClockError(err instanceof Error ? err.message : t('scoring.clock.actionFailed'));
      } finally {
        setClockLoading(false);
      }
    },
    [apiUrl, match.id, onRefresh, t],
  );

  // Scoring gate — DB status enum is 'scheduled' | 'running' | 'paused'
  // | 'completed' | 'voided'. Active scoring requires running OR paused.
  const scoringEnabled =
    (match.status === 'running' || match.status === 'paused') && !match.lockedAt;
  const clockRunning = clockState?.status === 'running';
  const remainingMs = remainingClockMs(
    matchFormat,
    match.phaseType ?? undefined,
    match.matchNumberLabel,
    clockState?.activeMs ?? 0,
  );
  const softClockLocked =
    !clockRunning &&
    matchFormat.timerMode === 'countdown' &&
    matchFormat.softClockLimitSeconds > 0 &&
    remainingMs !== null &&
    remainingMs < matchFormat.softClockLimitSeconds * 1000;
  const canScore = scoringEnabled && !clockRunning && !softClockLocked;
  const clockTimeMs = clockState?.activeMs ?? null;

  const submit = useScoringSubmit({
    apiUrl,
    matchId: match.id,
    nextSequence,
    clockTimeMs,
    config: scoringConfig,
    onExchangeRecorded: () => {
      setNextSequence((n) => n + 1);
      setRefreshKey((k) => k + 1);
    },
  });

  // Spacebar shortcut: toggles the primary clock action when no input
  // is focused and the drawer isn't open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (drawerOpen) return;
      const status = clockState?.status ?? 'idle';
      const action: 'start' | 'halt' | 'resume' | null =
        status === 'idle'
          ? 'start'
          : status === 'running'
            ? 'halt'
            : status === 'halted'
              ? 'resume'
              : null;
      if (!action) return;
      e.preventDefault();
      void onClockAction(action);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clockState?.status, drawerOpen, onClockAction]);

  const redName = match.redFighterName ?? t('scoring.lice.red');
  const blueName = match.blueFighterName ?? t('scoring.lice.blue');

  return (
    <div className="flex flex-1 flex-col bg-gray-950">
      <MatchHeader
        matchId={match.id}
        apiUrl={apiUrl}
        matchCode={match.roundCode ?? match.matchNumberLabel}
        redName={redName}
        blueName={blueName}
        config={scoringConfig}
        liceId={match.liceId ?? null}
        backHref={backHref}
        buildMatchHref={buildMatchHref}
        externalDisplayUrl={externalDisplayUrl ?? null}
        refreshKey={refreshKey}
        onOpenCorrections={() => setDrawerOpen(true)}
      />

      {match.lockedAt && (
        <div className="mx-4 mt-3 rounded-xl border border-yellow-700 bg-yellow-950 px-4 py-3 text-center text-sm font-bold text-yellow-100">
          {t('scoring.corrections.matchLocked')}
        </div>
      )}

      {/* Three-column scoring layout — RED | centre | BLUE */}
      <div className="grid flex-1 grid-cols-1 gap-2 p-3 md:grid-cols-[minmax(260px,1fr)_minmax(280px,360px)_minmax(260px,1fr)]">
        <ScoringColumn
          side="red"
          apiUrl={apiUrl}
          matchId={match.id}
          nextSequence={nextSequence}
          registrationId={match.redRegistrationId}
          fighterName={redName}
          club={match.redClub ?? null}
          score={match.redScore}
          config={scoringConfig}
          scoringEnabled={scoringEnabled}
          canScore={canScore}
          clockTimeMs={clockTimeMs}
          submit={submit}
          onPenaltyRecorded={() => {
            setNextSequence((n) => n + 1);
            setRefreshKey((k) => k + 1);
          }}
          penaltiesRefreshKey={refreshKey}
        />

        <ScoringCenterControls
          matchId={match.id}
          apiUrl={apiUrl}
          matchFormat={matchFormat}
          config={scoringConfig}
          redName={redName}
          blueName={blueName}
          redRegistrationId={match.redRegistrationId}
          blueRegistrationId={match.blueRegistrationId}
          canScore={canScore}
          clockState={clockState}
          clockLoading={clockLoading}
          clockError={clockError}
          onClockAction={onClockAction}
          submit={submit}
          refreshKey={refreshKey}
          onExchangeVoided={() => setRefreshKey((k) => k + 1)}
        />

        <ScoringColumn
          side="blue"
          apiUrl={apiUrl}
          matchId={match.id}
          nextSequence={nextSequence}
          registrationId={match.blueRegistrationId}
          fighterName={blueName}
          club={match.blueClub ?? null}
          score={match.blueScore}
          config={scoringConfig}
          scoringEnabled={scoringEnabled}
          canScore={canScore}
          clockTimeMs={clockTimeMs}
          submit={submit}
          onPenaltyRecorded={() => {
            setNextSequence((n) => n + 1);
            setRefreshKey((k) => k + 1);
          }}
          penaltiesRefreshKey={refreshKey}
        />
      </div>

      {/* Forfeit / withdraw at the bottom in light chrome */}
      <div className="border-t border-slate-200 bg-white p-4">
        <ForfeitPanel
          matchId={match.id}
          apiUrl={apiUrl}
          redRegistrationId={match.redRegistrationId}
          blueRegistrationId={match.blueRegistrationId}
          redName={redName}
          blueName={blueName}
          disabled={(match.status !== 'running' && match.status !== 'paused') || !!match.lockedAt}
          onForfeitRecorded={onRefresh}
        />
      </div>

      <MatchCorrectionsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        matchId={match.id}
        apiUrl={apiUrl}
        online={networkStatus === 'online'}
        locked={Boolean(match.lockedAt)}
        onDone={() => {
          onRefresh();
          setRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}

// ── Fallback view ─────────────────────────────────────────────────

interface NoMatchViewProps {
  mode?: 'lice' | 'match';
}

export function NoMatchView({ mode = 'lice' }: NoMatchViewProps) {
  const { t } = useI18n();
  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center p-8 text-center"
    >
      <div className="max-w-md">
        <h1 className="text-2xl font-bold text-white">
          {mode === 'match' ? t('scoring.match.unavailableTitle') : t('scoring.lice.noMatchTitle')}
        </h1>
        <p className="mt-3 text-gray-400">
          {mode === 'match'
            ? t('scoring.match.unavailableBody')
            : t('scoring.lice.noMatchDescription')}
        </p>
      </div>
    </main>
  );
}
