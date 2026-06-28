'use client';

import { useCallback, useEffect, useState } from 'react';
import { MatchHeader } from './MatchHeader';
import { ScoringColumn } from './ScoringColumn';
import { ScoringCenterControls } from './ScoringCenterControls';
import { MatchCorrectionsDrawer } from './MatchCorrectionsDrawer';
import { useI18n } from '../i18n/I18nProvider';
import { useScoringSubmit } from '../hooks/useScoringSubmit';
import type { ClockState } from './MatchClock';
import type { MatchFormatConfig, TournamentScoringConfig } from '@myclash/types';
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  DEFAULT_SCORING_CONFIG,
  pointCapWinnerSide,
} from '@myclash/types';
import { phaseTimeLimitSeconds } from './scoreboard-clock';
import { matchWinnerSide } from './match-winner';
import { resumeBlockedByRuleset } from './resume-guard';

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
  /** Header context line (Tournament · Pool · Piste) — from GET /matches/:id/summary. */
  tournamentName?: string | null;
  poolName?: string | null;
  liceName?: string | null;
  eventSlug?: string;
  phaseType?: 'pool' | 'single_elim' | 'double_elim' | 'swiss' | null;
  sideOrder?: 'red_left' | 'blue_left';
  lockedAt?: string | null;
  /** Set by page.tsx from the GET /matches/:id row so the header
   *  can build its back-link href and fetch the lice queue. */
  liceId?: string | null;
  /** Why the match ended ('max_doubles' | 'black_card' | 'forfeit' | ...).
   *  Drives the centre column's black-card banner. Null while in progress. */
  endReason?: string | null;
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
  // Resume guard: when the operator starts/resumes at zero / in the soft
  // zone, hold the action here and ask first (continue anyway / end match).
  const [pendingResume, setPendingResume] = useState<'start' | 'resume' | null>(null);
  // End-of-match result overlay; dismiss resets whenever the clock leaves
  // 'ended' so Reopen → end shows it again.
  const [resultDismissed, setResultDismissed] = useState(false);
  useEffect(() => {
    if (clockState?.status !== 'ended') setResultDismissed(false);
  }, [clockState?.status]);

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

  // Clock state machine: POST + refresh. Start/Resume at zero remaining /
  // inside the soft-clock zone is challenged first (per the ruleset the
  // clock should not restart) — the modal proceeds with `force`.
  const onClockAction = useCallback(
    async (
      action: 'start' | 'halt' | 'resume' | 'end' | 'reopen' | 'reset_clock',
      force = false,
    ) => {
      if (
        !force &&
        (action === 'start' || action === 'resume') &&
        resumeBlockedByRuleset(
          matchFormat,
          match.phaseType ?? undefined,
          match.matchNumberLabel,
          clockState?.activeMs ?? 0,
        )
      ) {
        setPendingResume(action);
        return;
      }
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
    [
      apiUrl,
      match.id,
      match.phaseType,
      match.matchNumberLabel,
      matchFormat,
      clockState?.activeMs,
      onRefresh,
      t,
    ],
  );

  // Scoring gate — DB status enum is 'scheduled' | 'running' | 'paused'
  // | 'completed' | 'voided'. Active scoring requires running OR paused.
  // The soft-clock zone does NOT lock scoring any more: with the clock
  // stopped at zero / inside the soft zone the operator keeps full control
  // (points, penalties, corrections) — the ruleset warning moved to the
  // Start/Resume action instead (resume guard below).
  const scoringEnabled =
    (match.status === 'running' || match.status === 'paused') && !match.lockedAt;
  const clockRunning = clockState?.status === 'running';
  const canScore = scoringEnabled && !clockRunning;
  const clockTimeMs = clockState?.activeMs ?? null;

  // Phase time limit (ms) — drives the corrections drawer's display-anchored
  // time adjust. Null in count-up mode or when no limit is configured.
  const limitSeconds = phaseTimeLimitSeconds(
    matchFormat,
    match.phaseType ?? undefined,
    match.matchNumberLabel,
  );
  const limitMs =
    matchFormat.timerMode === 'countdown' && limitSeconds !== null ? limitSeconds * 1000 : null;

  // Which side (if any) has won by reaching the point cap — drives the gold
  // score highlight. Reverse-aware (in reverse scoring, hitting 0 loses).
  const capWinnerSide = pointCapWinnerSide(match.redScore, match.blueScore, matchFormat);
  const reverseScoring = matchFormat.scoringDirection === 'reverse_zero_loses';

  // Score-changing actions (exchange, penalty) recompute the score
  // server-side. Besides the internal bump (clock + exchange/penalty
  // lists), call the parent onRefresh() so the GET /matches/:id row —
  // which carries red_score/blue_score + status — is re-fetched at once.
  // Without this the score only updated on the next clock action.
  const handleScoreMutation = useCallback(() => {
    setNextSequence((n) => n + 1);
    setRefreshKey((k) => k + 1);
    onRefresh();
  }, [onRefresh]);

  // Clearing (voiding) the last exchange also recomputes the score, but
  // must NOT advance the local sequence counter (no new exchange).
  const handleExchangeVoided = useCallback(() => {
    setRefreshKey((k) => k + 1);
    onRefresh();
  }, [onRefresh]);

  const submit = useScoringSubmit({
    apiUrl,
    matchId: match.id,
    nextSequence,
    clockTimeMs,
    config: scoringConfig,
    onExchangeRecorded: handleScoreMutation,
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
        tournamentName={match.tournamentName ?? null}
        poolName={match.poolName ?? null}
        liceName={match.liceName ?? null}
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
          reachedCap={capWinnerSide === 'red'}
          pointCap={matchFormat.pointCap}
          reverse={reverseScoring}
          config={scoringConfig}
          scoringEnabled={scoringEnabled}
          canScore={canScore}
          clockTimeMs={clockTimeMs}
          submit={submit}
          onPenaltyRecorded={handleScoreMutation}
          penaltiesRefreshKey={refreshKey}
        />

        <ScoringCenterControls
          matchId={match.id}
          apiUrl={apiUrl}
          matchStatus={match.status}
          endReason={match.endReason ?? null}
          matchFormat={matchFormat}
          phaseType={match.phaseType ?? undefined}
          matchNumberLabel={match.matchNumberLabel}
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
          onExchangeVoided={handleExchangeVoided}
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
          reachedCap={capWinnerSide === 'blue'}
          pointCap={matchFormat.pointCap}
          reverse={reverseScoring}
          config={scoringConfig}
          scoringEnabled={scoringEnabled}
          canScore={canScore}
          clockTimeMs={clockTimeMs}
          submit={submit}
          onPenaltyRecorded={handleScoreMutation}
          penaltiesRefreshKey={refreshKey}
        />
      </div>

      <MatchCorrectionsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        matchId={match.id}
        apiUrl={apiUrl}
        online={networkStatus === 'online'}
        locked={Boolean(match.lockedAt)}
        timerMode={matchFormat.timerMode}
        elapsedMs={clockState?.activeMs ?? 0}
        limitMs={limitMs}
        redName={redName}
        blueName={blueName}
        redRegistrationId={match.redRegistrationId}
        blueRegistrationId={match.blueRegistrationId}
        config={scoringConfig}
        refreshKey={refreshKey}
        forfeitDisabled={
          (match.status !== 'running' && match.status !== 'paused') || !!match.lockedAt
        }
        onDone={() => {
          onRefresh();
          setRefreshKey((k) => k + 1);
        }}
      />

      {/* Resume guard: the ruleset says the clock shouldn't restart at zero
          remaining / inside the soft zone — the operator decides. */}
      {pendingResume && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-yellow-700 bg-gray-900 p-6 text-center shadow-2xl">
            <p className="mb-2 text-lg font-bold text-yellow-300">
              {t('scoring.resumeGuard.title')}
            </p>
            <p className="mb-5 text-sm text-gray-300">{t('scoring.resumeGuard.message')}</p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const action = pendingResume;
                  setPendingResume(null);
                  void onClockAction(action, true);
                }}
                className="rounded-lg border-2 border-yellow-600 bg-yellow-900/40 px-4 py-2 text-sm font-bold text-yellow-200 hover:bg-yellow-900"
              >
                {t('scoring.resumeGuard.continueAnyway')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingResume(null);
                  void onClockAction('end');
                }}
                className="rounded-lg border-2 border-red-700 bg-red-950 px-4 py-2 text-sm font-bold text-red-200 hover:bg-red-900"
              >
                {t('scoring.resumeGuard.endMatch')}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setPendingResume(null)}
              className="mt-4 text-xs text-gray-500 hover:text-gray-300"
            >
              {t('scoring.result.close')}
            </button>
          </div>
        </div>
      )}

      {/* End-of-match result: winner (highest score) or draw. */}
      {clockState?.status === 'ended' && !resultDismissed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-xl border border-amber-600 bg-gray-900 p-8 text-center shadow-2xl">
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.3em] text-amber-400">
              {t('scoring.result.matchEnded')}
            </p>
            {(() => {
              const winner = matchWinnerSide(match.redScore, match.blueScore);
              return winner ? (
                <p className="mb-2 text-3xl font-black text-white">
                  🏆 {winner === 'red' ? redName : blueName}
                </p>
              ) : (
                <p className="mb-2 text-3xl font-black text-white">{t('scoring.result.draw')}</p>
              );
            })()}
            <p className="mb-6 font-mono text-2xl font-bold text-gray-300">
              {match.redScore} – {match.blueScore}
            </p>
            <button
              type="button"
              onClick={() => setResultDismissed(true)}
              className="rounded-lg border-2 border-gray-600 bg-gray-800 px-6 py-2 text-sm font-bold text-gray-200 hover:bg-gray-700"
            >
              {t('scoring.result.close')}
            </button>
          </div>
        </div>
      )}
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
