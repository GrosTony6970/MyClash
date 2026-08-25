'use client';

/**
 * ScoringCenterControls — centre column for the redesigned scoreboard.
 *
 * Renders, top-to-bottom:
 *   1. Status badge (HALTED / RUNNING / ENDED)
 *   2. Big timer numeral
 *   3. TOTAL TIME caption
 *   4. Primary Play/Pause toggle (Start / Pause / Resume / Re-open)
 *   5. Secondary row: small End match + Reset
 *   6. Double-count X/Y chip
 *   7. Double button (single, not per-side)
 *   8. No exchange button (single, not per-side)
 *   9. Exchanges: N count + Clear last exchange button
 *   10. Scrollable unified EVENTS list (exchanges + penalties)
 *   11. Spacebar hint (muted)
 */

import { useEffect, useMemo, useState } from 'react';
import type { LevelStep, MatchFormatConfig, TournamentScoringConfig } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import { useScoringTheme } from '../theme/ThemeProvider';
import {
  buildUnifiedTimeline,
  clockStatusSemantic,
  ConfirmDialog,
  MatchTimeline,
  sideStyle,
  statusPillTone,
} from '@myclash/ui';
import {
  clockShouldTick,
  displayClockMs,
  effectiveTimeLimitSeconds,
  elapsedActiveMs,
  formatClockMs,
  remedyToOffer,
  shouldWarnClock,
  suddenDeathElapsedMs,
  type ClockState,
} from './scoreboard-clock';
import type { MatchScoringData } from '../hooks/useMatchScoringData';
import type { UseScoringSubmitResult } from '../hooks/useScoringSubmit';
import { dequeueLastForMatch } from '../offline/outbox';
import { classifySyncFailure } from '../offline/failure-kind';
import type { SyncEngine } from '../offline/sync';
import { isDoubleLoss } from './is-double-loss';
import { blackCardLossRegistrationId } from './black-card-loss';
import { NoExchangeReasonDialog } from './NoExchangeReasonDialog';
import { apiRequest, failureMessage } from '@myclash/api-client';

interface ScoringCenterControlsProps {
  matchId: string;
  apiUrl: string;
  /** Match status (DB enum) — drives the DOUBLE LOSS banner once completed. */
  matchStatus: string;
  /** matches.end_reason — drives the BLACK CARD banner when 'black_card'. */
  endReason?: string | null;
  matchFormat: MatchFormatConfig;
  /** Phase + match label resolve the per-phase time limit and the countdown
   *  direction for the big clock. */
  phaseType?: 'pool' | 'single_elim' | 'double_elim' | 'swiss';
  matchNumberLabel?: string | null;
  config: TournamentScoringConfig;
  redName: string;
  blueName: string;
  redRegistrationId: string;
  blueRegistrationId: string;
  canScore: boolean;
  /** Current clock state. */
  clockState: ClockState | null;
  /** Loading + error from the clock action POST. */
  clockLoading: boolean;
  clockError: string | null;
  /**
   * Trigger a clock state machine transition. Handled by the parent
   * (MatchView) because the action + match-refresh wiring lives there.
   */
  onClockAction: (action: 'start' | 'halt' | 'resume' | 'end' | 'reopen' | 'reset_clock') => void;
  /** Shared scoring submit pipeline — Double + No exchange consume this. */
  submit: UseScoringSubmitResult;
  /** The match's events, read once by `MatchView`. */
  scoring: MatchScoringData;
  /**
   * Network state, from the page. Clear-last-exchange only needs it for the
   * half of the job that talks to the server — undoing a hit still sitting in
   * the outbox works offline.
   */
  online: boolean;
  /**
   * The durable-sync engine. Needed to ask `isDraining()` before deleting the
   * outbox tail: mid-drain that row may already be on the server.
   */
  syncEngine?: SyncEngine | null;
  /** Called after Clear-last-exchange voids a row. */
  onExchangeVoided?: () => void;
  /** Locked match → read-only: hide clock/scoring controls, keep timer + timeline. */
  readOnly?: boolean;
  // ── Best-of-N rounds ──
  /** True when bestOf > 1: the End button becomes "End round" + round pips show. */
  isBestOf?: boolean;
  currentRound?: number;
  redRoundWins?: number;
  blueRoundWins?: number;
  /** Round action POST in flight (advance / end-round). */
  roundBusy?: boolean;
  /** End the current round on time (best-of). Leader wins; tie → server rejects. */
  onEndRound?: () => void;
  // ── Level at time ──
  /**
   * The remedy this LEVEL bout is waiting on, or null when there is none to
   * play — a pool bout whose chain is a draw, a bout with a leader, or a bout
   * already in sudden death with nothing left to advance to.
   */
  levelPending?: LevelStep | null;
  /** Sudden death is live: the clock wears a skull and counts up. */
  inSuddenDeath?: boolean;
  /** Take the bout one step down its chain and apply the remedy. */
  onAdvanceLevelResolution?: () => void;
}

/** Renders MM:SS at full size with the centiseconds (:CS) smaller + muted. */
function ClockText({ ms }: { ms: number }) {
  const s = formatClockMs(ms);
  const i = s.lastIndexOf(':');
  if (i <= 0) return <>{s}</>;
  return (
    <>
      {s.slice(0, i)}
      <span className="text-[0.5em] font-bold opacity-60">{s.slice(i)}</span>
    </>
  );
}

export function ScoringCenterControls({
  matchId,
  apiUrl,
  matchStatus,
  endReason,
  matchFormat,
  phaseType,
  matchNumberLabel,
  config,
  redName,
  blueName,
  redRegistrationId,
  blueRegistrationId,
  canScore,
  clockState,
  clockLoading,
  clockError,
  onClockAction,
  submit,
  scoring,
  online,
  syncEngine,
  onExchangeVoided,
  readOnly,
  isBestOf = false,
  currentRound = 1,
  redRoundWins = 0,
  blueRoundWins = 0,
  roundBusy = false,
  onEndRound,
  levelPending = null,
  inSuddenDeath = false,
  onAdvanceLevelResolution,
}: ScoringCenterControlsProps) {
  const { t } = useI18n();
  // This column IS the pad, so it takes the pad scope. Needed in JS because
  // statusPillTone picks raw palette classes by argument — they cannot follow
  // the CSS scope the way a semantic token class does.
  const { padScope } = useScoringTheme();
  const status = clockState?.status ?? 'idle';
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [noExchangeOpen, setNoExchangeOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  /**
   * Rows queued for THIS match. Not the sync bar's count, which is
   * `totalPendingCount()` across every match — that would light this button up
   * over another bout's backlog.
   *
   * Without it the button is dead exactly when it is needed most: score three
   * hits offline from a fresh match and the server list is still empty, so
   * `activeExchanges.length === 0` greys out an undo for three real hits.
   *
   * Read off the lifted hook rather than counted here. The local copy this
   * replaces re-derived on `[matchId, refreshKey]`, which meant a BACKGROUND
   * drain — a reconnect, or the engine retrying on its own — never moved it.
   */
  const {
    activeExchanges,
    activePenalties,
    pendingExchanges,
    pendingPenalties,
    pendingHere,
    refreshExchanges,
  } = scoring;

  // Live ticker — runs while running AND while halted so the wall-clock
  // TOTAL TIME keeps flowing through pauses (the big clock is unaffected:
  // elapsedActiveMs is constant when not running). Frozen when idle/ended.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!clockShouldTick(status)) return;
    const id = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(id);
  }, [status]);

  // Raw accumulated active ms; the big clock counts DOWN from the phase limit
  // in countdown mode and UP otherwise (scoreboard-clock is the single source).
  const elapsedMs = useMemo(() => elapsedActiveMs(clockState, now), [clockState, now]);
  const shownMs = displayClockMs(elapsedMs, matchFormat, phaseType, matchNumberLabel);
  const warned = shouldWarnClock(elapsedMs, matchFormat, phaseType, matchNumberLabel);
  // How long sudden death has been running — the count-up UNDER the skull. A
  // countdown pinned at 00:00 says nothing about how long the deciding exchange
  // has taken, which is the one number that matters once the chain is spent.
  const limitSeconds = effectiveTimeLimitSeconds(matchFormat, phaseType, matchNumberLabel);
  const suddenDeathMs = suddenDeathElapsedMs(
    elapsedMs,
    matchFormat.timerMode === 'countdown' && limitSeconds !== null ? limitSeconds * 1000 : null,
  );
  // The remedy button, or nothing. Resolved HERE rather than where the chain is
  // read, because this is the only place holding the LIVE elapsed time: the
  // fetched clock is refreshed after a successful action, and a refused End is
  // not one, so a bout crossing its limit would grow no button until something
  // else happened to refetch.
  const offeredRemedy = remedyToOffer(
    levelPending,
    elapsedMs,
    matchFormat,
    phaseType,
    matchNumberLabel,
  );

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- intentional manual memo the React Compiler cannot preserve.
  const totalMs = useMemo(() => {
    if (!clockState?.startedAt) return 0;
    return now - new Date(clockState.startedAt).getTime();
  }, [clockState?.startedAt, now]);

  // Queued doubles count. Max-doubles is a rule the referee acts on — a bout
  // ends on it — so a chip that stops moving offline is worse than no chip.
  // `isDoubleLoss` is gated on a COMPLETED match, so including these cannot
  // flip the DOUBLE LOSS banner on a bout still being fought.
  const doubleCount =
    activeExchanges.filter((e) => e.type === 'double').length +
    pendingExchanges.filter((e) => e.type === 'double').length;
  const maxDoubles = matchFormat.maxDoubleHits;
  const doubleLoss = isDoubleLoss(matchStatus, doubleCount, maxDoubles);

  // Black card closed the match (per the penalty ruleset). Name the carded
  // fighter so the banner reads "Black card — {fighter}".
  const blackCardLoserRegId = blackCardLossRegistrationId(endReason, activePenalties);
  const blackCardLoserName =
    blackCardLoserRegId === redRegistrationId
      ? redName
      : blackCardLoserRegId === blueRegistrationId
        ? blueName
        : null;
  const doubleChipTone = (() => {
    if (maxDoubles === null) return 'bg-surface text-foreground-secondary';
    if (doubleCount >= maxDoubles) return 'bg-danger/20 text-danger border border-danger';
    if (doubleCount >= maxDoubles - 1) return 'bg-warning/20 text-warning border border-warning';
    return 'bg-surface text-foreground-secondary';
  })();

  const events = useMemo(
    () =>
      buildUnifiedTimeline({
        // Server rows and queued rows in one list. `buildUnifiedTimeline`
        // orders on `occurredAt` then `sequence` and numbers the result 1..N,
        // so a queued hit lands where it belongs rather than being appended —
        // and the `#` numbers stay the shared ones every other surface uses.
        exchanges: [...activeExchanges, ...pendingExchanges],
        penalties: [...activePenalties, ...pendingPenalties],
        redName,
        blueName,
        redRegId: redRegistrationId,
        blueRegId: blueRegistrationId,
        t,
        config,
      }),
    [
      activeExchanges,
      activePenalties,
      pendingExchanges,
      pendingPenalties,
      redName,
      blueName,
      redRegistrationId,
      blueRegistrationId,
      t,
      config,
    ],
  );

  /**
   * Undo the hit the referee actually scored.
   *
   * Two cases, and only one of them needs a network. The outbox already answers
   * "is this exchange on the server?" — pending means no — so a queued hit is
   * undone by deleting the local row, with no fetch at all. That is what makes
   * this work offline, where it used to fire a PATCH, ignore the response, and
   * report success over a synthetic 503 that voided nothing.
   *
   * ORDER MATTERS: outbox first, not `online` first. Online, `submit` enqueues
   * then drains immediately, so the tail is normally already synced — but if
   * that drain failed against a live network the entry is pending WHILE online,
   * and voiding it server-side would 404 on an exchange the server never saw.
   *
   * Not a queued void. Deleting an unsynced row is strictly more correct than
   * voiding: it never leaves a `voided` row behind for a hit that never left
   * the tablet.
   *
   * No local count to decrement after a dequeue: `onExchangeVoided` bumps the
   * refresh key on the same tick and the lifted outbox read follows.
   */
  async function clearLastExchange() {
    setClearBusy(true);
    setClearError(null);
    try {
      // Mid-drain the tail may already be POSTed and awaiting markSynced, so
      // deleting it locally would leave the hit on the server with the referee
      // believing it gone. A drain running means the network is up, so the
      // server path below is available.
      if (!syncEngine?.isDraining()) {
        const dequeued = await dequeueLastForMatch(matchId);
        if (dequeued) {
          onExchangeVoided?.();
          return;
        }
      }

      // Nothing queued → the last exchange is on the server.
      const lastExchange = activeExchanges[activeExchanges.length - 1];
      if (!lastExchange) return;
      if (!online) {
        setClearError(t('scoring.corrections.onlineOnly'));
        return;
      }

      const result = await apiRequest(apiUrl, `/api/v1/exchanges/${lastExchange.id}/void`, {
        method: 'PATCH',
        body: { reason: 'Clear last exchange (referee)' },
      });
      if (!result.ok) {
        // Still the classifier the outbox drain uses, so the pad keeps ONE
        // failure vocabulary: the service worker's synthetic 503 reads as
        // offline, not as the server having an opinion. A `network` failure is
        // the same event one layer down, which is the status 0 it already took.
        const kind = classifySyncFailure(
          result.kind === 'aborted' || result.kind === 'network' ? 0 : result.status,
          null,
        );
        const message =
          kind === 'offline'
            ? t('scoring.corrections.onlineOnly')
            : failureMessage(result, t, t('scoring.corrections.clearLastFailed'));
        if (message) setClearError(message);
        return;
      }
      refreshExchanges();
      onExchangeVoided?.();
    } finally {
      setClearBusy(false);
    }
  }

  const primary = primaryAction(status);

  return (
    <div className="flex flex-col items-center gap-3 px-2 py-3">
      {/* Double-loss banner — the double cap was hit, both fighters lose
          and the match is closed (scoring is already locked by status). */}
      {doubleLoss && (
        <div className="w-full rounded-xl border-2 border-danger bg-danger/15 px-4 py-3 text-center">
          <p className="text-lg font-black uppercase tracking-widest text-danger">
            {t('scoring.liveMatch.doubleLoss')}
          </p>
          <p className="mt-1 text-xs font-semibold text-danger">
            {t('scoring.liveMatch.doubleLossSubtitle')}
          </p>
        </div>
      )}

      {/* Black-card banner — a black card closed the match per the penalty
          ruleset; the carded fighter forfeits, the opponent wins. Page-black
          edged in ink, so it literally reads as a black card against the
          lighter surface it sits on. */}
      {blackCardLoserName && (
        <div className="w-full rounded-xl border-2 border-foreground bg-background px-4 py-3 text-center">
          <p className="text-lg font-black uppercase tracking-widest text-foreground">
            {t('scoring.liveMatch.blackCard')}
          </p>
          <p className="mt-1 text-xs font-semibold text-foreground-secondary">
            {blackCardLoserName}
          </p>
        </div>
      )}

      {/* Status badge */}
      {(() => {
        const tone = statusPillTone(clockStatusSemantic(status), padScope);
        return (
          <span
            data-testid="clock-status"
            data-status={status}
            className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-widest ${tone.className} ${
              tone.pulse ? 'animate-pulse' : ''
            }`}
          >
            {status}
          </span>
        );
      })()}

      {/* SUDDEN DEATH replaces the numeral with a skull and a count-up. A
          countdown pinned at 00:00 tells the referee nothing, and the one
          number that matters is how long the deciding exchange has taken.
          It ends when a fighter LEADS — never "the next point", because one
          afterblow can score both of them and leave the bout as level as it
          was. Scoring keeps the pad's normal gate throughout. */}
      {inSuddenDeath ? (
        <div className="flex flex-col items-center gap-1" data-testid="sudden-death">
          <span
            className="text-6xl leading-none"
            role="img"
            aria-label={t('scoring.level.suddenDeathBanner')}
          >
            💀
          </span>
          <span className="text-xs font-bold uppercase tracking-widest text-danger">
            {t('scoring.level.suddenDeathBanner')}
          </span>
          <span className="font-mono text-2xl font-black tabular-nums leading-none text-foreground">
            <ClockText ms={suddenDeathMs} />
          </span>
          <span className="text-xs text-muted">{t('scoring.level.suddenDeathHint')}</span>
        </div>
      ) : (
        /* Timer — countdown-aware; turns red in the final 10s of a countdown. */
        <p
          className={`font-mono text-6xl font-black tabular-nums leading-none ${
            warned
              ? 'text-danger'
              : status === 'running'
                ? 'text-foreground'
                : status === 'halted'
                  ? 'text-warning'
                  : status === 'ended'
                    ? 'text-muted'
                    : 'text-muted/70'
          }`}
        >
          <ClockText ms={shownMs} />
        </p>
      )}

      {/* Total time */}
      {clockState?.startedAt && (
        <p className="text-xs uppercase tracking-widest text-muted">
          {t('scoring.clock.totalTime')}{' '}
          <span className="font-mono">
            <ClockText ms={totalMs} />
          </span>
        </p>
      )}

      {clockError && <p className="text-center text-xs text-danger">{clockError}</p>}

      {!readOnly && (
        <>
          {/* Primary Play/Pause toggle */}
          {primary && (
            <button
              type="button"
              data-testid="clock-primary-button"
              // The single button that is Start / Pause / Resume / Re-open by
              // turn, so `data-action` is the only reliable way to say WHICH
              // transition was just taken.
              data-action={primary.action}
              disabled={clockLoading}
              onClick={() => onClockAction(primary.action)}
              className={`min-h-[64px] w-full max-w-[280px] rounded-2xl border-2 px-6 text-lg font-bold transition-colors disabled:opacity-40 ${primary.classes}`}
            >
              {primary.icon} {t(primary.labelKey)}
            </button>
          )}

          {/* Secondary row: End + Reset. In best-of, the End button ends the
              current ROUND on time (leader wins; the server completes the match
              only when the series clinches). */}
          <div className="flex gap-2">
            {status !== 'idle' && status !== 'ended' && (
              <button
                type="button"
                data-testid="clock-end-button"
                disabled={clockLoading || roundBusy}
                onClick={() => (isBestOf && onEndRound ? onEndRound() : onClockAction('end'))}
                className="min-h-[44px] rounded-lg border-2 border-danger bg-danger/20 px-4 py-1.5 text-sm font-bold text-danger hover:bg-danger/30 active:bg-danger/40 disabled:opacity-40"
              >
                {isBestOf ? t('scoring.rounds.endRound') : t('scoring.clock.endMatch')}
              </button>
            )}
            {/* The remedy this LEVEL bout is waiting on. Shown only when the
                phase's chain offers one AND the bout's time has run out — a pool
                bout, whose chain is a single draw, keeps the two buttons it has
                always had, and no bout offers its remedy early. The SERVER still
                decides whether it applies; this only names it. */}
            {offeredRemedy && onAdvanceLevelResolution && (
              <button
                type="button"
                data-testid="level-resolution-button"
                data-remedy={offeredRemedy.kind}
                disabled={clockLoading || roundBusy}
                onClick={onAdvanceLevelResolution}
                className="min-h-[44px] rounded-lg border-2 border-warning bg-warning/20 px-4 py-1.5 text-sm font-bold text-warning hover:bg-warning/30 active:bg-warning/40 disabled:opacity-40"
              >
                {offeredRemedy.kind === 'extra_time'
                  ? t('scoring.level.playExtraTime', { seconds: offeredRemedy.seconds })
                  : t('scoring.level.playSuddenDeath')}
              </button>
            )}
            {status === 'halted' && (
              <button
                type="button"
                disabled={clockLoading}
                onClick={() => setResetConfirmOpen(true)}
                className="min-h-[44px] rounded-lg border-2 border-border bg-surface px-4 py-1.5 text-sm font-bold text-foreground-secondary hover:bg-border active:bg-muted/40 disabled:opacity-40"
              >
                {t('scoring.clock.reset')}
              </button>
            )}
          </div>

          {/* Reset clock confirmation — shared ConfirmDialog */}
          <ConfirmDialog
            open={resetConfirmOpen}
            onConfirm={() => {
              onClockAction('reset_clock');
              setResetConfirmOpen(false);
            }}
            onCancel={() => setResetConfirmOpen(false)}
            title={t('scoring.clock.resetConfirmTitle')}
            description={t('scoring.clock.resetConfirmBody')}
            confirmLabel={t('scoring.clock.resetConfirmAction')}
            cancelLabel={t('scoring.clock.resetConfirmCancel')}
            danger
          />

          {/* Best-of round counter + round-win pips (Round N / R wins – B wins) */}
          {isBestOf && (
            <div className="mt-2 flex items-center justify-center gap-2 text-xs font-bold">
              <span className="text-muted">
                {t('scoring.rounds.label', { current: String(currentRound) })}
              </span>
              <span className="rounded-full border border-border bg-surface px-3 py-0.5 tabular-nums text-foreground-secondary">
                <span style={{ color: sideStyle(config, 'red').border }}>{redRoundWins}</span>
                <span className="mx-1 text-muted">–</span>
                <span style={{ color: sideStyle(config, 'blue').border }}>{blueRoundWins}</span>
              </span>
            </div>
          )}

          {/* Double-count X/Y chip + Double button */}
          <div className="flex flex-col items-center gap-1 mt-2 w-full">
            <span
              data-testid="double-count"
              data-count={doubleCount}
              title={t('scoring.lice.doubleLimitTooltip')}
              className={`rounded-full px-3 py-0.5 text-xs font-bold tabular-nums ${doubleChipTone}`}
            >
              {doubleCount}/{maxDoubles ?? '∞'}
            </span>
            <button
              type="button"
              data-testid="double-button"
              disabled={!canScore || submit.submitting}
              onClick={() => submit.submitDouble()}
              className="w-full max-w-[280px] min-h-[48px] rounded-xl border-2 border-warning bg-warning/15 px-4 py-2 text-sm font-bold text-warning hover:bg-warning/25 active:bg-warning/35 disabled:opacity-40"
            >
              ⚔ {t('scoring.lice.eventRowDouble')}
            </button>
            {/* Opens the reason picker rather than recording straight away —
                the pad used to hard-code 'other' on every no-exchange. */}
            <button
              type="button"
              data-testid="no-exchange-button"
              disabled={!canScore || submit.submitting}
              onClick={() => setNoExchangeOpen(true)}
              className="w-full max-w-[280px] min-h-[48px] rounded-xl border-2 border-border bg-surface px-4 py-2 text-sm font-bold text-foreground-secondary hover:bg-border active:bg-muted/40 disabled:opacity-40"
            >
              ⏸ {t('scoring.lice.eventRowNoExchange')}
            </button>
          </div>

          <NoExchangeReasonDialog
            open={noExchangeOpen}
            onClose={() => setNoExchangeOpen(false)}
            onChoose={(reason) => submit.submitNoExchange(reason)}
            busy={submit.submitting}
          />

          {/* Exchanges count + Clear last exchange */}
          <div className="flex flex-col items-center gap-1 mt-3 w-full">
            <p className="text-xs text-muted">
              {t('scoring.lice.exchangesCount', { count: String(events.length) })}
            </p>
            <button
              type="button"
              // Pending hits count too. Offline the server list is frozen at
              // whatever last loaded, so on a fresh match it is empty while the
              // outbox holds real hits — gating on it alone kills the undo
              // exactly when the referee needs it.
              disabled={(activeExchanges.length === 0 && pendingHere === 0) || clearBusy}
              onClick={() => void clearLastExchange()}
              // `info`, not `danger`: clearing the last exchange is a routine
              // correction a referee makes constantly, and the cyan this
              // replaces existed only to read as "not one of the red actions".
              className="w-full max-w-[280px] min-h-[48px] rounded-xl border-2 border-info bg-info/20 px-4 py-2 text-sm font-bold text-info hover:bg-info/30 active:bg-info/40 disabled:opacity-40 touch-manipulation"
            >
              ↶ {t('scoring.corrections.clearLastExchange')}
            </button>
            {clearError && (
              <p className="text-center text-xs text-danger" role="alert">
                {clearError}
              </p>
            )}
          </div>
        </>
      )}

      {/* Events list — scrollable unified timeline */}
      <div className="w-full mt-3">
        <p className="text-xs font-bold uppercase tracking-wide text-muted mb-1.5 text-center">
          {t('scoring.lice.eventsHeader')}
        </p>
        <MatchTimeline events={events} ariaLabel={t('scoring.lice.eventsHeader')} t={t} />
      </div>

      {/* Spacebar hint (when idle) */}
      {!readOnly && status === 'idle' && (
        <p className="mt-2 text-[10px] text-muted">{t('scoring.lice.spacebarHint')}</p>
      )}
    </div>
  );
}

// ── Primary action mapping ────────────────────────────────────────

function primaryAction(status: 'idle' | 'running' | 'halted' | 'ended'): {
  action: 'start' | 'halt' | 'resume' | 'end' | 'reopen' | 'reset_clock';
  labelKey: string;
  icon: string;
  classes: string;
} | null {
  switch (status) {
    case 'idle':
      return {
        action: 'start',
        labelKey: 'scoring.clock.start',
        icon: '▶',
        classes:
          'border-success bg-success text-success-foreground hover:bg-success-hover active:bg-success-hover',
      };
    case 'running':
      return {
        action: 'halt',
        labelKey: 'scoring.clock.pauseShort',
        icon: '⏸',
        classes:
          'border-warning bg-warning text-warning-foreground hover:bg-warning-hover active:bg-warning-hover',
      };
    case 'halted':
      return {
        action: 'resume',
        labelKey: 'scoring.clock.resume',
        icon: '▶',
        classes:
          'border-success bg-success text-success-foreground hover:bg-success-hover active:bg-success-hover',
      };
    case 'ended':
      return {
        action: 'reopen',
        labelKey: 'scoring.clock.reopen',
        icon: '↻',
        classes: 'border-border bg-surface text-foreground hover:bg-border active:bg-muted/40',
      };
    default:
      return null;
  }
}
