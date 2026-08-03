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
import type { MatchFormatConfig, TournamentScoringConfig } from '@myclash/types';
import { useI18n } from '../i18n/I18nProvider';
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
  elapsedActiveMs,
  formatClockMs,
  shouldWarnClock,
  type ClockState,
} from './scoreboard-clock';
import { useExchanges } from '../hooks/useExchanges';
import { usePenalties } from '../hooks/usePenalties';
import type { UseScoringSubmitResult } from '../hooks/useScoringSubmit';
import { isDoubleLoss } from './is-double-loss';
import { blackCardLossRegistrationId } from './black-card-loss';
import { NoExchangeReasonDialog } from './NoExchangeReasonDialog';

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
  /** Bumped externally when an exchange or penalty is recorded/voided. */
  refreshKey: number;
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
  refreshKey,
  onExchangeVoided,
  readOnly,
  isBestOf = false,
  currentRound = 1,
  redRoundWins = 0,
  blueRoundWins = 0,
  roundBusy = false,
  onEndRound,
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

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- intentional manual memo the React Compiler cannot preserve.
  const totalMs = useMemo(() => {
    if (!clockState?.startedAt) return 0;
    return now - new Date(clockState.startedAt).getTime();
  }, [clockState?.startedAt, now]);

  const { active: activeExchanges, refresh: refreshExchanges } = useExchanges(
    apiUrl,
    matchId,
    refreshKey,
  );
  const { active: activePenalties } = usePenalties(apiUrl, matchId, refreshKey);

  const doubleCount = activeExchanges.filter((e) => e.type === 'double').length;
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
        exchanges: activeExchanges,
        penalties: activePenalties,
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
      redName,
      blueName,
      redRegistrationId,
      blueRegistrationId,
      t,
      config,
    ],
  );

  async function clearLastExchange() {
    const lastExchange = activeExchanges[activeExchanges.length - 1];
    if (!lastExchange) return;
    setClearBusy(true);
    try {
      await fetch(`${apiUrl}/api/v1/exchanges/${lastExchange.id}/void`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: 'Clear last exchange (referee)' }),
      });
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

      {/* Timer — countdown-aware; turns red in the final 10s of a countdown. */}
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
              disabled={activeExchanges.length === 0 || clearBusy}
              onClick={() => void clearLastExchange()}
              // `info`, not `danger`: clearing the last exchange is a routine
              // correction a referee makes constantly, and the cyan this
              // replaces existed only to read as "not one of the red actions".
              className="w-full max-w-[280px] min-h-[48px] rounded-xl border-2 border-info bg-info/20 px-4 py-2 text-sm font-bold text-info hover:bg-info/30 active:bg-info/40 disabled:opacity-40 touch-manipulation"
            >
              ↶ {t('scoring.corrections.clearLastExchange')}
            </button>
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
