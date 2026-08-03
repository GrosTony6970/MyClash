'use client';

import { useCallback, useEffect, useState } from 'react';
import { MatchHeader } from './MatchHeader';
import { ScoringColumn } from './ScoringColumn';
import { ScoringCenterControls } from './ScoringCenterControls';
import { MatchCorrectionsDrawer } from './MatchCorrectionsDrawer';
import { MatchResultOverlay } from './MatchResultOverlay';
import { useI18n } from '../i18n/I18nProvider';
import { useScoringSubmit } from '../hooks/useScoringSubmit';
import { nextSequence as outboxNextSequence } from '../offline/outbox';
import type { SyncEngine } from '../offline/sync';
import type { ClockState } from './MatchClock';
import type { MatchFormatConfig, TournamentScoringConfig } from '@myclash/types';
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  DEFAULT_SCORING_CONFIG,
  pointCapWinnerSide,
} from '@myclash/types';
import { sideStyle, useAdjacentMatches } from '@myclash/ui';
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
  // ── Best-of-N rounds (bestOf = 1 → single round, all unset/0 → today's UI) ──
  /** Effective best-of for this match's phase (from GET /matches/:id/summary). */
  bestOf?: number;
  currentRound?: number;
  redRoundWins?: number;
  blueRoundWins?: number;
  /** Closed-round snapshots [{round, redScore, blueScore, winnerColor, endReason}]. */
  roundsJson?: unknown;
  /** A round ended but the series isn't decided — show the Start-round overlay. */
  awaitingRoundAdvance?: boolean;
}

export interface MatchViewProps {
  match: MatchInfo;
  apiUrl: string;
  networkStatus: 'online' | 'offline';
  /** Durable-sync engine from the page; exchanges go through its outbox. */
  syncEngine?: SyncEngine | null;
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
  syncEngine,
  onRefresh,
  externalDisplayUrl,
  backHref,
  buildMatchHref,
}: MatchViewProps) {
  const { t } = useI18n();
  const [nextSequence, setNextSequence] = useState(1);
  // Seed the sequence counter — a fresh mount must NOT restart at 1 when the
  // match already has exchanges (mid-match reload, device swap, second pad):
  // a stale sequence collides with UNIQUE(match_id, sequence) server-side and
  // the offline outbox drops the 400 terminally — the scored hit vanishes.
  // The IndexedDB outbox/synced seed covers offline same-device reloads; the
  // server fetch covers device swaps. Functional max keeps taps recorded
  // before seeding completes monotonic.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      const seeds = [await outboxNextSequence(match.id)];
      try {
        const res = await fetch(`${apiUrl}/api/v1/matches/${match.id}/exchanges`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (res.ok) {
          const rows = (await res.json()) as Array<{ sequence?: number | null }>;
          seeds.push(rows.reduce((max, row) => Math.max(max, row.sequence ?? 0), 0) + 1);
        }
      } catch {
        // Offline — the IndexedDB seed alone is correct for same-device reloads.
      }
      if (!cancelled) setNextSequence((n) => Math.max(n, ...seeds));
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiUrl, match.id]);
  const [scoringConfig, setScoringConfig] =
    useState<TournamentScoringConfig>(DEFAULT_SCORING_CONFIG);
  const [matchFormat, setMatchFormat] = useState<MatchFormatConfig>(DEFAULT_MATCH_FORMAT_CONFIG);
  const [clockState, setClockState] = useState<ClockState | null>(null);
  const [clockLoading, setClockLoading] = useState(false);
  const [clockError, setClockError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  // Next bout in the lice queue — powers the "Next match →" action on the result overlay.
  const { next: nextMatch } = useAdjacentMatches(apiUrl, match.id, refreshKey);
  // Resume guard: when the operator starts/resumes at zero / in the soft
  // zone, hold the action here and ask first (continue anyway / end match).
  const [pendingResume, setPendingResume] = useState<'start' | 'resume' | null>(null);
  // End-of-match result overlay; dismiss resets whenever the clock leaves
  // 'ended' so Reopen → end shows it again.
  const [resultDismissed, setResultDismissed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the dismiss flag when the clock leaves 'ended'.
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchClockState() loads + syncs the clock on mount/refresh.
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

  // Reopen (unlock) a locked match. The API authorizes: organiser always,
  // event staff only when the tournament's auto-lock is disabled (403 otherwise).
  async function handleUnlock() {
    setUnlockBusy(true);
    setUnlockError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/matches/${match.id}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('scoring.match.unlockFailed'));
      }
      onRefresh();
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : t('scoring.match.unlockFailed'));
    } finally {
      setUnlockBusy(false);
    }
  }

  // ── Best-of-N round lifecycle ──────────────────────────────────────────────
  const bestOf = match.bestOf ?? 1;
  const currentRound = match.currentRound ?? 1;
  const redRoundWins = match.redRoundWins ?? 0;
  const blueRoundWins = match.blueRoundWins ?? 0;
  const isBestOf = bestOf > 1;
  const awaitingRoundAdvance = !!match.awaitingRoundAdvance;
  const [roundBusy, setRoundBusy] = useState(false);

  // Start the next round (best-of). Resets the clock + open-round score server-side.
  const onRoundAdvance = useCallback(async () => {
    setRoundBusy(true);
    setClockError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/matches/${match.id}/rounds/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('scoring.clock.actionFailed'));
      }
      await fetchClockState();
      onRefresh();
    } catch (err) {
      setClockError(err instanceof Error ? err.message : t('scoring.clock.actionFailed'));
    } finally {
      setRoundBusy(false);
    }
  }, [apiUrl, match.id, fetchClockState, onRefresh, t]);

  // End the current round on time (best-of). The server picks the leader as the
  // round winner; a tied round is rejected so the operator plays a sudden-death point.
  const onEndRound = useCallback(async () => {
    setRoundBusy(true);
    setClockError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/matches/${match.id}/rounds/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('scoring.clock.actionFailed'));
      }
      await fetchClockState();
      onRefresh();
    } catch (err) {
      setClockError(err instanceof Error ? err.message : t('scoring.clock.actionFailed'));
    } finally {
      setRoundBusy(false);
    }
  }, [apiUrl, match.id, fetchClockState, onRefresh, t]);

  // Scoring gate — DB status enum is 'scheduled' | 'running' | 'paused'
  // | 'completed' | 'voided'. Active scoring requires running OR paused.
  // The soft-clock zone does NOT lock scoring any more: with the clock
  // stopped at zero / inside the soft zone the operator keeps full control
  // (points, penalties, corrections) — the ruleset warning moved to the
  // Start/Resume action instead (resume guard below). Best-of also blocks
  // scoring while a round is awaiting advance (the operator must start the next).
  const scoringEnabled =
    (match.status === 'running' || match.status === 'paused') &&
    !match.lockedAt &&
    !awaitingRoundAdvance;
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
    syncEngine,
    onExchangeRecorded: handleScoreMutation,
  });

  // Spacebar shortcut: toggles the primary clock action when no input
  // is focused, the drawer isn't open, and no modal is up.
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
      // Any open modal blocks the shortcut. Asked of the DOM rather than
      // tracked as state because the dialogs are owned by children (the
      // no-exchange reason picker in ScoringCenterControls, the reset-clock
      // confirm next to it) — lifting each one's open flag up here would mean
      // this guard silently misses the next dialog anyone adds. Every shared
      // primitive (Modal, ConfirmDialog, PromptDialog) portals to <body> with
      // this exact pair of attributes.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
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
    <div className="flex flex-1 flex-col bg-background">
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
        bestOf={bestOf}
        currentRound={currentRound}
        redRoundWins={redRoundWins}
        blueRoundWins={blueRoundWins}
      />

      {match.lockedAt && (
        <div className="mx-4 mt-3 flex flex-col items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-center text-sm font-bold text-warning">
          <span>{t('scoring.corrections.matchLocked')}</span>
          {unlockError && <span className="text-xs font-normal text-danger">{unlockError}</span>}
          <button
            type="button"
            disabled={unlockBusy}
            onClick={() => void handleUnlock()}
            className="min-h-[44px] rounded-lg border-2 border-warning bg-warning/20 px-4 py-2 text-sm font-bold text-warning hover:bg-warning/30 disabled:opacity-40"
          >
            ↻ {unlockBusy ? t('scoring.match.reopening') : t('scoring.match.reopen')}
          </button>
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
          leading={!reverseScoring && match.redScore > match.blueScore}
          readOnly={!!match.lockedAt}
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
          readOnly={!!match.lockedAt}
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
          onClockAction={(action) => void onClockAction(action)}
          submit={submit}
          refreshKey={refreshKey}
          onExchangeVoided={handleExchangeVoided}
          isBestOf={isBestOf}
          currentRound={currentRound}
          redRoundWins={redRoundWins}
          blueRoundWins={blueRoundWins}
          roundBusy={roundBusy}
          onEndRound={() => void onEndRound()}
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
          leading={!reverseScoring && match.blueScore > match.redScore}
          readOnly={!!match.lockedAt}
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
        nextSequence={nextSequence}
        clockTimeMs={clockTimeMs}
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
        <div className="fixed inset-0 z-overlay flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-warning/40 bg-surface p-6 text-center shadow-2xl">
            <p className="mb-2 text-lg font-bold text-warning">{t('scoring.resumeGuard.title')}</p>
            <p className="mb-5 text-sm text-foreground-secondary">
              {t('scoring.resumeGuard.message')}
            </p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const action = pendingResume;
                  setPendingResume(null);
                  void onClockAction(action, true);
                }}
                className="rounded-lg border-2 border-warning bg-warning/20 px-4 py-2 text-sm font-bold text-warning hover:bg-warning/30"
              >
                {t('scoring.resumeGuard.continueAnyway')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingResume(null);
                  void onClockAction('end');
                }}
                className="rounded-lg border-2 border-danger bg-danger/20 px-4 py-2 text-sm font-bold text-danger hover:bg-danger/30"
              >
                {t('scoring.resumeGuard.endMatch')}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setPendingResume(null)}
              className="mt-4 text-xs text-muted hover:text-foreground-secondary"
            >
              {t('scoring.result.close')}
            </button>
          </div>
        </div>
      )}

      {/* Best-of round break: a round ended without clinching the match — show
          the round result and let the operator start the next round (resets the
          clock + score to 0–0). Mutually exclusive with the final-result overlay
          (a clinched round ends the clock instead of awaiting). */}
      {isBestOf && awaitingRoundAdvance && clockState?.status !== 'ended' && (
        <div className="fixed inset-0 z-overlay flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-xl border border-info/60 bg-surface p-8 text-center shadow-2xl">
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.3em] text-info">
              {t('scoring.rounds.roundComplete', { round: String(currentRound) })}
            </p>
            {(() => {
              const winner = matchWinnerSide(match.redScore, match.blueScore);
              const winnerName = winner === 'red' ? redName : winner === 'blue' ? blueName : null;
              const winnerColor = winner ? sideStyle(scoringConfig, winner).border : undefined;
              return winnerName ? (
                <p className="mb-2 text-2xl font-black" style={{ color: winnerColor }}>
                  <span aria-hidden>🏆</span> {winnerName}
                </p>
              ) : null;
            })()}
            <p className="mb-4 font-mono text-2xl font-bold text-foreground-secondary">
              {match.redScore} – {match.blueScore}
            </p>
            <p className="mb-6 text-sm font-semibold text-muted">
              {t('scoring.rounds.seriesTally')}{' '}
              <span style={{ color: sideStyle(scoringConfig, 'red').border }}>{redRoundWins}</span>
              {' – '}
              <span style={{ color: sideStyle(scoringConfig, 'blue').border }}>
                {blueRoundWins}
              </span>
            </p>
            {clockError && <p className="mb-3 text-xs font-normal text-danger">{clockError}</p>}
            <button
              type="button"
              disabled={roundBusy}
              onClick={() => void onRoundAdvance()}
              className="rounded-lg border-2 border-info bg-info/20 px-6 py-2 text-sm font-bold text-info hover:bg-info/30 disabled:opacity-40"
            >
              {t('scoring.rounds.startRound', { round: String(currentRound + 1) })} →
            </button>
          </div>
        </div>
      )}

      {/* End-of-match review: winner, score, and how the bout got there. */}
      {clockState?.status === 'ended' && !resultDismissed && (
        <MatchResultOverlay
          apiUrl={apiUrl}
          matchId={match.id}
          redName={redName}
          blueName={blueName}
          redRegistrationId={match.redRegistrationId}
          blueRegistrationId={match.blueRegistrationId}
          redScore={match.redScore}
          blueScore={match.blueScore}
          endReason={match.endReason}
          bestOf={bestOf}
          currentRound={currentRound}
          scoringConfig={scoringConfig}
          matchFormat={matchFormat}
          clockState={clockState}
          refreshKey={refreshKey}
          nextMatchHref={
            nextMatch ? (buildMatchHref ?? ((id: string) => `/matches/${id}`))(nextMatch.id) : null
          }
          onClose={() => setResultDismissed(true)}
        />
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
        <h1 className="text-2xl font-bold text-foreground">
          {mode === 'match' ? t('scoring.match.unavailableTitle') : t('scoring.lice.noMatchTitle')}
        </h1>
        <p className="mt-3 text-muted">
          {mode === 'match'
            ? t('scoring.match.unavailableBody')
            : t('scoring.lice.noMatchDescription')}
        </p>
      </div>
    </main>
  );
}
