'use client';

import { useCallback, useEffect, useState } from 'react';
import { MatchHeader } from './MatchHeader';
import { ScoringColumn } from './ScoringColumn';
import { ScoringCenterControls } from './ScoringCenterControls';
import { MatchCorrectionsDrawer } from './MatchCorrectionsDrawer';
import { MatchResultOverlay } from './MatchResultOverlay';
import { EndEarlyDialog, ResumeGuardDialog, RoundBreakDialog } from './MatchPauseDialogs';
import { useI18n } from '@myclash/next-i18n/client';
import { usePadClock } from '../hooks/usePadClock';
import { useScoringSubmit, writeHit } from '../hooks/useScoringSubmit';
import { boutNames, heldRowNotice } from '../lib/held-hit';
import { endRefusalMessage, refusalMessage } from '../lib/refusal-copy';
import { nextSequence as outboxNextSequence } from '../offline/outbox';
import { boutStatusOnPad, resultUnconfirmed, tabletResult } from '../offline/pad-clock';
import { queuePress } from '../offline/press-queue';
import type { SyncEngine } from '../offline/sync';
import { fetchWithCache } from '../offline/cached-reads';
import { useSendEnded, useSyncState } from '../offline/use-sync-state';
import { useMatchScoringData } from '../hooks/useMatchScoringData';
import type { ClockState } from './MatchClock';
import type { ClockPress, MatchFormatConfig, TournamentScoringConfig } from '@myclash/types';
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  DEFAULT_SCORING_CONFIG,
  pointCapWinnerColor,
} from '@myclash/types';
import { sideStyle, useAdjacentMatches } from '@myclash/ui';
import { effectiveTimeLimitSeconds, elapsedActiveMs, levelChainApplies } from './scoreboard-clock';
import { pendingLevelStep, type LevelStep } from '@myclash/types';
import { closedRoundWinner } from './round-winner';
import { resumeBlockedByRuleset } from './resume-guard';
import { endIsEarly, endRefusedOnPad } from './end-guard';
import { apiRequest } from '@myclash/api-client';

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
  /** The RECORDED winner. Authoritative over the two scores — a forfeit or a
   *  `referee_decision` override can award the bout to the fighter behind on
   *  points, and the end-of-match overlay announces it to the hall. */
  winnerRegistrationId?: string | null;
  redFighterName?: string;
  blueFighterName?: string;
  redClub?: string | null;
  blueClub?: string | null;
  weapon?: string;
  tournamentId?: string;
  /** Header context line (Tournament · Phase · Piste) — from GET /matches/:id/summary. */
  tournamentName?: string | null;
  poolName?: string | null;
  /** Round token (`SF`, `R16`, `S3`, `GF`) for the phase slot on bracket and
   *  Swiss matches, which have no pool and so named no phase at all. */
  roundToken?: string | null;
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
  /**
   * When the tablet read this bout from the server (ms), if what is on screen
   * is the tablet's COPY, opened because the server could not be reached
   * (`offline/kept-bout.ts`). Null for the server's own answer.
   */
  readFromTabletAt?: number | null;
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
  readFromTabletAt = null,
}: MatchViewProps) {
  const { t, locale } = useI18n();
  // Drives the outbox re-read below: a BACKGROUND drain empties the queue with
  // no mutation to notice it, and the provisional score would otherwise linger
  // after the server had already accepted the hits.
  const syncState = useSyncState(syncEngine ?? null);
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
      // Offline is the ordinary case here and says nothing: the IndexedDB seed
      // alone is correct for a same-device reload.
      const result = await apiRequest<Array<{ sequence?: number | null }>>(
        apiUrl,
        `/api/v1/matches/${match.id}/exchanges`,
        { signal: controller.signal },
      );
      if (result.ok) {
        seeds.push(result.data.reduce((max, row) => Math.max(max, row.sequence ?? 0), 0) + 1);
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
  const [clockLoading, setClockLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // The clock on screen: the server's last answer plus the presses this
  // tablet still holds (`usePadClock`). It is read at the open and after each
  // send; a press of this screen moves it at once.
  const padClock = usePadClock({
    apiUrl,
    matchId: match.id,
    refreshKey,
    syncEngine,
    pendingCount: syncState?.pendingCount ?? 0,
    rejectedCount: syncState?.rejectedCount ?? 0,
    t,
  });
  const clockState: ClockState | null = padClock.clock;
  const clockError = padClock.error;
  const { setError: setClockError, readClock: fetchClockState, pressed: clockPressed } = padClock;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  // Next bout in the lice queue — powers the "Next match →" action on the result overlay.
  const { previous: previousMatch, next: nextMatch } = useAdjacentMatches(
    apiUrl,
    match.id,
    refreshKey,
  );
  // Resume guard: when the operator starts/resumes at zero / in the soft
  // zone, hold the action here and ask first (continue anyway / end match).
  const [pendingResume, setPendingResume] = useState<'start' | 'resume' | null>(null);
  // "End match" was pressed before the cap or the time: the question is up.
  const [pendingEnd, setPendingEnd] = useState(false);
  // End-of-match result overlay; dismiss resets whenever the clock leaves
  // 'ended' so Reopen → end shows it again.
  const [resultDismissed, setResultDismissed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the dismiss flag when the clock leaves 'ended'.
    if (clockState?.status !== 'ended') setResultDismissed(false);
  }, [clockState?.status]);

  /**
   * The tournament's scoring rules — the buttons the referee presses.
   *
   * Cached on the tablet, because the failure mode here is silent and
   * permanent. This state starts at DEFAULT_SCORING_CONFIG (+2/+1, deductive)
   * and the fetch was guarded `if (res.ok)`, so a failure left the federal
   * default in place and said nothing. The match and the config are separate
   * requests: on a weak hall network one lands and the other does not, and the
   * pad then renders a working scoring surface with the WRONG buttons. A
   * referee taps +2 on a tournament whose ruleset says +3, a 2 is queued, a 2
   * is stored, and nothing ever mentions it.
   *
   * `configStale` drives the notice: seeded from the tablet, not confirmed with
   * the server. Better than the default in every case, and unlike the default
   * it admits what it is.
   */
  const [configStale, setConfigStale] = useState(false);
  useEffect(() => {
    if (!match.tournamentId) return;
    const controller = new AbortController();
    let cancelled = false;
    void fetchWithCache<{
      scoringConfig: TournamentScoringConfig;
      matchFormat: MatchFormatConfig;
    }>(apiUrl, `/api/v1/tournaments/${match.tournamentId}/match-config`, {
      signal: controller.signal,
    }).then((result) => {
      if (cancelled || !result) return;
      setScoringConfig(result.body.scoringConfig);
      setMatchFormat(result.body.matchFormat);
      setConfigStale(!result.fresh);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [match.tournamentId, apiUrl]);

  // ── Level at time ──────────────────────────────────────────────────────────
  //
  // A bout that is LEVEL when the clock runs out follows the phase's chain of
  // remedies. The server refuses the End and names what to play; the pad reads
  // the same chain so it can LABEL the button before pressing it, and so the
  // clock can wear a skull instead of a numeral once sudden death is live.
  //
  // A ROUND of a best-of match is a bout too, and works the chain from the top:
  // `levelChainApplies` says when, and its own tests say why.
  //
  // Declared HERE, above `onClockAction`, because the resume challenge reads
  // `inSuddenDeath` — a bout in sudden death sits at 00:00 by design.
  const levelSteps = clockState?.levelResolutionSteps ?? 0;
  const chainApplies = levelChainApplies({
    redScore: match.redScore,
    blueScore: match.blueScore,
    awaitingRoundAdvance: match.awaitingRoundAdvance,
  });
  const levelPending: LevelStep | null = chainApplies
    ? pendingLevelStep(
        matchFormat,
        match.phaseType ?? undefined,
        match.matchNumberLabel,
        levelSteps,
      )
    : null;
  // The step already APPLIED — one behind the pending one. Sudden death is
  // terminal, so it is live from the moment it was applied until someone leads.
  const levelApplied: LevelStep | null =
    chainApplies && levelSteps > 0
      ? pendingLevelStep(
          matchFormat,
          match.phaseType ?? undefined,
          match.matchNumberLabel,
          levelSteps - 1,
        )
      : null;
  const inSuddenDeath = levelApplied?.kind === 'sudden_death';

  // A Start, a Halt, a Resume or an End acts on this screen at once and is
  // sent behind, with a network or with none (operator, 2026-10-10). The press
  // is written on the tablet, in the bout's own order with its hits, and the
  // queue sends it. A refusal comes a moment later: the press is then held in
  // the inbox, the clock goes back to what the server says, and the reason is
  // said at the clock (`heldPressNotice`). The page reads the bout again at
  // the end of each send, as it does for a hit.
  const bout = boutNames(match);
  const pressClock = useCallback(
    async (action: ClockPress, endScore?: { red: number; blue: number }) => {
      setClockError(null);
      const written = await writeHit(
        async () => {
          await queuePress({ matchId: match.id, action, bout, endScore });
        },
        syncEngine,
        clockPressed,
      );
      if (written === 'not_saved') setClockError(t('scoring.lice.hitNotSaved'));
    },
    // `bout` is three strings of the bout's row: its fields are the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [match.id, bout.label, bout.red, bout.blue, syncEngine, clockPressed, setClockError, t],
  );

  // Reopen and Reset are a person's, with a network (ruling 13): the server
  // answers them under the finger, as every clock press did before.
  const askServerClock = useCallback(
    async (action: 'reopen' | 'reset_clock') => {
      setClockLoading(true);
      setClockError(null);
      try {
        const result = await apiRequest<ClockState>(apiUrl, `/api/v1/matches/${match.id}/clock`, {
          method: 'POST',
          body: { action },
        });
        if (!result.ok) {
          // A refusal says this screen's picture of the bout is old: read it again.
          onRefresh();
          throw new Error(refusalMessage(result, t, 'scoring.clock.actionFailed') ?? '');
        }
        await fetchClockState();
        // Bump the parent refresh so match.status updates (which gates
        // the scoring buttons + penalty picker).
        onRefresh();
      } catch (err) {
        setClockError(err instanceof Error ? err.message : t('scoring.clock.actionFailed'));
      } finally {
        setClockLoading(false);
      }
    },
    [apiUrl, match.id, fetchClockState, onRefresh, setClockError, t],
  );

  // Clock state machine. Start/Resume at zero remaining / inside the
  // soft-clock zone is challenged first (per the ruleset the clock should not
  // restart) — the modal proceeds with `force`.
  const onClockAction = useCallback(
    async (
      action: 'start' | 'halt' | 'resume' | 'end' | 'reopen' | 'reset_clock',
      force = false,
      endScore?: { red: number; blue: number },
    ) => {
      if (
        !force &&
        (action === 'start' || action === 'resume') &&
        resumeBlockedByRuleset(
          matchFormat,
          match.phaseType ?? undefined,
          match.matchNumberLabel,
          clockState?.activeMs ?? 0,
          inSuddenDeath,
        )
      ) {
        setPendingResume(action);
        return;
      }
      if (action === 'reopen' || action === 'reset_clock') await askServerClock(action);
      else await pressClock(action, endScore);
    },
    [
      match.phaseType,
      match.matchNumberLabel,
      matchFormat,
      clockState?.activeMs,
      inSuddenDeath,
      askServerClock,
      pressClock,
    ],
  );

  // Reopen (unlock) a locked match. The API authorizes: organiser always,
  // event staff only when the tournament's auto-lock is disabled (403 otherwise).
  async function handleUnlock() {
    setUnlockBusy(true);
    setUnlockError(null);
    try {
      const result = await apiRequest(apiUrl, `/api/v1/matches/${match.id}/unlock`, {
        method: 'POST',
        body: {},
      });
      if (!result.ok) {
        throw new Error(refusalMessage(result, t, 'scoring.match.unlockFailed') ?? '');
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
      const result = await apiRequest(apiUrl, `/api/v1/matches/${match.id}/rounds/advance`, {
        method: 'POST',
        body: {},
      });
      if (!result.ok) {
        throw new Error(refusalMessage(result, t, 'scoring.clock.actionFailed') ?? '');
      }
      await fetchClockState();
      onRefresh();
    } catch (err) {
      setClockError(err instanceof Error ? err.message : t('scoring.clock.actionFailed'));
    } finally {
      setRoundBusy(false);
    }
  }, [apiUrl, match.id, fetchClockState, onRefresh, setClockError, t]);

  // End the current round on time (best-of). The server picks the leader as the
  // round winner; a tied round is rejected so the operator plays a sudden-death point.
  const onEndRound = useCallback(async () => {
    setRoundBusy(true);
    setClockError(null);
    try {
      const result = await apiRequest(apiUrl, `/api/v1/matches/${match.id}/rounds/end`, {
        method: 'POST',
        body: {},
      });
      if (!result.ok) {
        throw new Error(refusalMessage(result, t, 'scoring.clock.actionFailed') ?? '');
      }
      await fetchClockState();
      onRefresh();
    } catch (err) {
      setClockError(err instanceof Error ? err.message : t('scoring.clock.actionFailed'));
    } finally {
      setRoundBusy(false);
    }
  }, [apiUrl, match.id, fetchClockState, onRefresh, setClockError, t]);

  const onAdvanceLevelResolution = useCallback(async () => {
    setRoundBusy(true);
    setClockError(null);
    try {
      const result = await apiRequest(
        apiUrl,
        `/api/v1/matches/${match.id}/level-resolution/advance`,
        { method: 'POST', body: {} },
      );
      if (!result.ok) {
        throw new Error(refusalMessage(result, t, 'scoring.clock.actionFailed') ?? '');
      }
      await fetchClockState();
      onRefresh();
    } catch (err) {
      setClockError(err instanceof Error ? err.message : t('scoring.clock.actionFailed'));
    } finally {
      setRoundBusy(false);
    }
  }, [apiUrl, match.id, fetchClockState, onRefresh, setClockError, t]);

  // Scoring gate — DB status enum is 'scheduled' | 'running' | 'paused'
  // | 'completed' | 'voided'. Active scoring requires running OR paused.
  // The soft-clock zone does NOT lock scoring any more: with the clock
  // stopped at zero / inside the soft zone the operator keeps full control
  // (points, penalties, corrections) — the ruleset warning moved to the
  // Start/Resume action instead (resume guard below). Best-of also blocks
  // scoring while a round is awaiting advance (the operator must start the next).
  // The bout's status is the pad's: a bout this tablet started with no
  // network is in play here before the server knows (`boutStatusOnPad`).
  const boutStatus = boutStatusOnPad(match.status, clockState?.status ?? 'idle');
  const scoringEnabled =
    (boutStatus === 'running' || boutStatus === 'paused') &&
    !match.lockedAt &&
    !awaitingRoundAdvance;
  const clockRunning = clockState?.status === 'running';
  const canScore = scoringEnabled && !clockRunning;
  const clockTimeMs = clockState?.activeMs ?? null;

  // Phase time limit (ms) — drives the corrections drawer's display-anchored
  // time adjust. Null in count-up mode or when no limit is configured.
  const limitSeconds = effectiveTimeLimitSeconds(
    matchFormat,
    match.phaseType ?? undefined,
    match.matchNumberLabel,
  );
  const limitMs =
    matchFormat.timerMode === 'countdown' && limitSeconds !== null ? limitSeconds * 1000 : null;

  /**
   * The score, plus what the tablet is still holding.
   *
   * `match.redScore` is the server's (or the tablet's copy of it), and offline it stops moving — the read
   * that refreshes it 503s. So a referee scoring three hits in a dead hall
   * watched the number stand still with no way to tell whether the tablet had
   * heard them. The queued hits are on disk; this adds them up.
   *
   * PROVISIONAL, AND SAID SO. The server remains the only thing that DERIVES a
   * stored score — nothing here is written anywhere. This is the optimistic
   * local apply ARCHITECTURE.md §10.2 has described since the sync engine was
   * written and which was never implemented.
   *
   * THE DRAIN RACE IS NOW DEDUPED, and it used to be double-counted here. This
   * block passed empty server lists to `pendingRowsForMatch`, so between a POST
   * succeeding and `markSynced` deleting the outbox row the hit was added twice
   * — the timeline and the double-count chip deduped, the score did not. Going
   * through `useMatchScoringData` means the same `client_uuid` dedupe every
   * other surface gets.
   *
   * It swaps one narrow transient for another rather than removing it: the
   * score can now read one hit LOW for a tick if `/exchanges` lands before the
   * page's `/matches/:id`. Both settle on the next read, and a number that
   * briefly lags is a smaller lie than one that briefly double-counts. A hit
   * the server took leaves the queue at once and the server is read at the
   * end of the pass: while a long queue goes out, the score reads LOW by the
   * hits already taken, and comes right when the pass ends.
   */
  const scoring = useMatchScoringData({
    apiUrl,
    matchId: match.id,
    refreshKey,
    config: scoringConfig,
    redRegistrationId: match.redRegistrationId,
    blueRegistrationId: match.blueRegistrationId,
    syncPendingCount: syncState?.pendingCount ?? 0,
  });
  const provisional = scoring.provisional;
  const redScore = match.redScore + provisional.red;
  const blueScore = match.blueScore + provisional.blue;

  // Which side (if any) has won by reaching the point cap — drives the gold
  // score highlight. Reverse-aware (in reverse scoring, hitting 0 loses).
  // Reads the provisional score on purpose: it only paints a numeral gold, and
  // a referee needs to see the cap coming while the tablet is offline. It
  // cannot end a bout: the result overlay opens on the CLOCK being ended, and
  // only "End match" ends the clock.
  const capWinnerSide = pointCapWinnerColor({ redScore, blueScore }, matchFormat);
  const reverseScoring = matchFormat.scoringDirection === 'reverse_zero_loses';

  // The controls' clock buttons. "End match" before the cap or the time is asked
  // about first (`end-guard.ts`). It reads the score on the screen, unsent hits
  // included, because that is the score the official ends the bout on. The
  // resume warning's own "End match" does not come here: it is already the
  // answer to a question.
  const onControlsClockAction = (action: Parameters<typeof onClockAction>[0]) => {
    const early =
      action === 'end' &&
      endIsEarly(
        matchFormat,
        match.phaseType ?? undefined,
        match.matchNumberLabel,
        elapsedActiveMs(clockState, Date.now()),
        { redScore, blueScore },
      );
    if (early) setPendingEnd(true);
    else if (action === 'end') endMatch();
    else void onClockAction(action);
  };

  // "End match" is taken on the tablet (ruling 11), so the two refusals the
  // server gives a level bout are given here first (`endRefusedOnPad`). A
  // best-of bout is not judged here: the server ends its round or its series.
  function endMatch() {
    const refused = isBestOf
      ? null
      : endRefusedOnPad({
          matchFormat,
          phaseType: match.phaseType ?? undefined,
          matchNumberLabel: match.matchNumberLabel,
          elapsedMs: elapsedActiveMs(clockState, Date.now()),
          score: { redScore, blueScore },
          levelStepsTaken: levelSteps,
        });
    if (refused) setClockError(endRefusalMessage(refused, t));
    // The End carries the score it is pressed on, for the result screen.
    else void onClockAction('end', false, { red: redScore, blue: blueScore });
  }

  // The result is the tablet's own until the server's row says "completed":
  // the score the End was pressed on, and its leader. Never an old row of the
  // server, and never a score that moves while the queue goes out (ruling 11).
  const unconfirmed = resultUnconfirmed(match.status, clockState?.status ?? 'idle');
  const ownResult = tabletResult(padClock.endScore, { red: redScore, blue: blueScore });

  // A row of this bout the server refused, a press, a hit or a card: said at
  // the clock, with the way out. The rows of this bout wait behind it until
  // the inbox acts.
  const heldPressNotice = heldRowNotice(padClock.heldRows[0], t);

  // A hit or a card was written on the tablet. The press reads nothing from
  // the server (ruling 316): the engine says the new count, which shows the
  // hit as provisional, and the ONE read of the server per scored hit
  // follows the end of its send (`useSendEnded`, below and in the page).
  const moveSequenceOn = useCallback(() => setNextSequence((n) => n + 1), []);

  // Clearing (voiding) the last exchange also recomputes the score, but
  // must NOT advance the local sequence counter (no new exchange).
  const handleExchangeVoided = useCallback(() => {
    setRefreshKey((k) => k + 1);
    onRefresh();
  }, [onRefresh]);
  // No press waits for the send (ruling 316): the lists are read again when it
  // has ended. The page reads the bout itself then.
  const readListsAgain = useCallback(() => setRefreshKey((k) => k + 1), []);
  useSendEnded(syncEngine, readListsAgain);

  const submit = useScoringSubmit({
    matchId: match.id,
    nextSequence,
    clockTimeMs,
    bout: boutNames(match),
    syncEngine,
    onExchangeRecorded: moveSequenceOn,
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
      // A locked bout shows no clock button: the key presses none either.
      if (match.lockedAt) return;
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
  }, [clockState?.status, drawerOpen, match.lockedAt, onClockAction]);

  const redName = match.redFighterName ?? t('scoring.lice.red');
  const blueName = match.blueFighterName ?? t('scoring.lice.blue');
  const roundWinnerSide = closedRoundWinner(match.roundsJson, currentRound);
  const roundWinner = roundWinnerSide
    ? {
        name: roundWinnerSide === 'red' ? redName : blueName,
        color: sideStyle(scoringConfig, roundWinnerSide).border,
      }
    : null;

  return (
    <div className="flex flex-1 flex-col bg-background">
      <MatchHeader
        matchId={match.id}
        matchCode={match.roundCode ?? match.matchNumberLabel}
        tournamentName={match.tournamentName ?? null}
        poolName={match.poolName ?? null}
        roundToken={match.roundToken ?? null}
        liceName={match.liceName ?? null}
        redName={redName}
        blueName={blueName}
        config={scoringConfig}
        liceId={match.liceId ?? null}
        backHref={backHref}
        buildMatchHref={buildMatchHref}
        externalDisplayUrl={externalDisplayUrl ?? null}
        previous={previousMatch}
        next={nextMatch}
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

      {/* The whole bout came off the tablet: the server could not be reached.
          Said with the DAY of the copy, because a copy can be a day old
          (operator ruling 10), and before anything is scored on it. */}
      {readFromTabletAt !== null && (
        <div
          role="status"
          data-testid="bout-from-tablet"
          className="mx-4 mt-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2 text-center text-xs font-bold text-warning"
        >
          {t('scoring.match.fromTablet', {
            when: new Date(readFromTabletAt).toLocaleString(locale, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            }),
          })}
        </div>
      )}

      {/* The buttons below came off the tablet, not the server. Said out loud
          because the alternative this replaced was the federal default arming
          itself in silence — and a referee cannot tell +2 from +3 by looking
          at a button that says +2. */}
      {configStale && (
        <div className="mx-4 mt-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2 text-center text-xs font-bold text-warning">
          {t('scoring.match.configFromCache')}
        </div>
      )}

      {/* Three-column scoring layout — RED | centre | BLUE */}
      <div className="grid flex-1 grid-cols-1 gap-2 p-3 md:grid-cols-[minmax(260px,1fr)_minmax(280px,360px)_minmax(260px,1fr)]">
        <ScoringColumn
          side="red"
          matchId={match.id}
          nextSequence={nextSequence}
          syncEngine={syncEngine}
          registrationId={match.redRegistrationId}
          fighterName={redName}
          club={match.redClub ?? null}
          score={redScore}
          provisionalDelta={provisional.red}
          reachedCap={capWinnerSide === 'red'}
          unconfirmed={readFromTabletAt !== null}
          leading={!reverseScoring && redScore > blueScore}
          readOnly={!!match.lockedAt}
          pointCap={matchFormat.pointCap}
          reverse={reverseScoring}
          config={scoringConfig}
          scoringEnabled={scoringEnabled}
          canScore={canScore}
          clockTimeMs={clockTimeMs}
          submit={submit}
          onPenaltyRecorded={moveSequenceOn}
          scoring={scoring}
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
          pressesWaiting={padClock.pressesWaiting > 0 || padClock.heldPresses.length > 0}
          heldPressNotice={heldPressNotice}
          onClockAction={onControlsClockAction}
          submit={submit}
          scoring={scoring}
          syncEngine={syncEngine}
          onExchangeVoided={handleExchangeVoided}
          isBestOf={isBestOf}
          currentRound={currentRound}
          redRoundWins={redRoundWins}
          blueRoundWins={blueRoundWins}
          roundBusy={roundBusy}
          onEndRound={() => void onEndRound()}
          levelPending={levelPending}
          inSuddenDeath={inSuddenDeath}
          onAdvanceLevelResolution={() => void onAdvanceLevelResolution()}
        />

        <ScoringColumn
          side="blue"
          matchId={match.id}
          nextSequence={nextSequence}
          syncEngine={syncEngine}
          registrationId={match.blueRegistrationId}
          fighterName={blueName}
          club={match.blueClub ?? null}
          score={blueScore}
          provisionalDelta={provisional.blue}
          reachedCap={capWinnerSide === 'blue'}
          unconfirmed={readFromTabletAt !== null}
          leading={!reverseScoring && blueScore > redScore}
          readOnly={!!match.lockedAt}
          pointCap={matchFormat.pointCap}
          reverse={reverseScoring}
          config={scoringConfig}
          scoringEnabled={scoringEnabled}
          canScore={canScore}
          clockTimeMs={clockTimeMs}
          submit={submit}
          onPenaltyRecorded={moveSequenceOn}
          scoring={scoring}
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
        syncEngine={syncEngine}
        bout={submit.bout}
        onCardQueued={moveSequenceOn}
        config={scoringConfig}
        scoring={scoring}
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
      <ResumeGuardDialog
        open={pendingResume !== null}
        onClose={() => setPendingResume(null)}
        onContinue={() => {
          const action = pendingResume;
          setPendingResume(null);
          if (action) void onClockAction(action, true);
        }}
        onEndMatch={() => {
          setPendingResume(null);
          endMatch();
        }}
      />

      <EndEarlyDialog
        open={pendingEnd}
        onClose={() => setPendingEnd(false)}
        onEndMatch={() => {
          setPendingEnd(false);
          endMatch();
        }}
      />

      {/* Best-of round break: a round ended without clinching the match — show
          the round result and let the operator start the next round (resets the
          clock + score to 0–0). Mutually exclusive with the final-result overlay
          (a clinched round ends the clock instead of awaiting). The ROUND's
          winner, from `rounds_json` — not the match's, and not the live score,
          which is about to reset to 0-0. */}
      <RoundBreakDialog
        open={isBestOf && awaitingRoundAdvance && clockState?.status !== 'ended'}
        round={currentRound}
        winner={roundWinner}
        redScore={match.redScore}
        blueScore={match.blueScore}
        redRoundWins={redRoundWins}
        blueRoundWins={blueRoundWins}
        redColor={sideStyle(scoringConfig, 'red').border}
        blueColor={sideStyle(scoringConfig, 'blue').border}
        error={clockError}
        busy={roundBusy}
        onStart={() => void onRoundAdvance()}
      />

      {/* End-of-match review: winner, score, and how the bout got there. */}
      {clockState?.status === 'ended' && !resultDismissed && (
        <MatchResultOverlay
          redName={redName}
          blueName={blueName}
          redRegistrationId={match.redRegistrationId}
          blueRegistrationId={match.blueRegistrationId}
          unconfirmed={unconfirmed}
          redScore={unconfirmed ? ownResult.red : match.redScore}
          blueScore={unconfirmed ? ownResult.blue : match.blueScore}
          winnerRegistrationId={unconfirmed ? null : (match.winnerRegistrationId ?? null)}
          endReason={match.endReason}
          bestOf={bestOf}
          currentRound={currentRound}
          scoringConfig={scoringConfig}
          matchFormat={matchFormat}
          clockState={clockState}
          scoring={scoring}
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

/**
 * The bout was never read, because no read reached the server. Not `NoMatchView`:
 * "deleted or rescheduled" is a guess the page cannot make with no answer. The
 * page reads again by itself when the network is back; Retry is for the
 * official who will not wait. Inside the page's own `main`, so it opens none.
 */
export function BoutNotLoadedView({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      data-testid="bout-not-loaded"
      className="flex flex-1 items-center justify-center p-8 text-center"
    >
      <div className="max-w-md">
        <h1 className="text-2xl font-bold text-foreground">{t('scoring.match.notLoadedTitle')}</h1>
        <p className="mt-3 text-muted">{t('scoring.match.notLoadedBody')}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 min-h-[44px] rounded-lg border-2 border-border bg-surface px-6 py-2 text-sm font-bold text-foreground hover:bg-border"
        >
          {t('scoring.lice.retry')}
        </button>
      </div>
    </div>
  );
}
