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

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchFormatConfig, TournamentScoringConfig } from '@myclash/types';
import { useI18n } from '../i18n/I18nProvider';
import { ConfirmDialog, clockStatusSemantic, sideStyle, statusPillTone } from '@myclash/ui';
import {
  clockShouldTick,
  displayClockMs,
  elapsedActiveMs,
  formatClockMs,
  shouldWarnClock,
  type ClockState,
} from './scoreboard-clock';
import { buildUnifiedTimeline } from './exchange-timeline';
import { useExchanges } from '../hooks/useExchanges';
import { usePenalties, type PenaltyCard } from '../hooks/usePenalties';
import type { UseScoringSubmitResult } from '../hooks/useScoringSubmit';
import { isDoubleLoss } from './is-double-loss';
import { blackCardLossRegistrationId } from './black-card-loss';

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
  const status = clockState?.status ?? 'idle';
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
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
    if (maxDoubles === null) return 'bg-gray-800 text-gray-300';
    if (doubleCount >= maxDoubles) return 'bg-red-900 text-red-200 border border-red-500';
    if (doubleCount >= maxDoubles - 1) return 'bg-amber-900 text-amber-200 border border-amber-500';
    return 'bg-gray-800 text-gray-300';
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

  const eventsListRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (eventsListRef.current) eventsListRef.current.scrollTop = 0;
  }, [events.length]);

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
        <div className="w-full rounded-xl border-2 border-red-500 bg-red-950 px-4 py-3 text-center">
          <p className="text-lg font-black uppercase tracking-widest text-red-300">
            {t('scoring.liveMatch.doubleLoss')}
          </p>
          <p className="mt-1 text-xs font-semibold text-red-200">
            {t('scoring.liveMatch.doubleLossSubtitle')}
          </p>
        </div>
      )}

      {/* Black-card banner — a black card closed the match per the penalty
          ruleset; the carded fighter forfeits, the opponent wins. */}
      {blackCardLoserName && (
        <div className="w-full rounded-xl border-2 border-gray-100 bg-gray-900 px-4 py-3 text-center">
          <p className="text-lg font-black uppercase tracking-widest text-white">
            {t('scoring.liveMatch.blackCard')}
          </p>
          <p className="mt-1 text-xs font-semibold text-gray-300">{blackCardLoserName}</p>
        </div>
      )}

      {/* Status badge */}
      {(() => {
        const tone = statusPillTone(clockStatusSemantic(status), 'dark');
        return (
          <span
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
            ? 'text-red-500'
            : status === 'running'
              ? 'text-white'
              : status === 'halted'
                ? 'text-yellow-400'
                : status === 'ended'
                  ? 'text-gray-500'
                  : 'text-gray-600'
        }`}
      >
        <ClockText ms={shownMs} />
      </p>

      {/* Total time */}
      {clockState?.startedAt && (
        <p className="text-xs uppercase tracking-widest text-gray-500">
          {t('scoring.clock.totalTime')}{' '}
          <span className="font-mono">
            <ClockText ms={totalMs} />
          </span>
        </p>
      )}

      {clockError && <p className="text-center text-xs text-red-400">{clockError}</p>}

      {!readOnly && (
        <>
          {/* Primary Play/Pause toggle */}
          {primary && (
            <button
              type="button"
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
                disabled={clockLoading || roundBusy}
                onClick={() => (isBestOf && onEndRound ? onEndRound() : onClockAction('end'))}
                className="min-h-[44px] rounded-lg border-2 border-red-700 bg-red-950 px-4 py-1.5 text-sm font-bold text-red-200 hover:bg-red-900 active:bg-red-800 disabled:opacity-40"
              >
                {isBestOf ? t('scoring.rounds.endRound') : t('scoring.clock.endMatch')}
              </button>
            )}
            {status === 'halted' && (
              <button
                type="button"
                disabled={clockLoading}
                onClick={() => setResetConfirmOpen(true)}
                className="min-h-[44px] rounded-lg border-2 border-gray-600 bg-gray-800 px-4 py-1.5 text-sm font-bold text-gray-200 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-40"
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
              <span className="text-slate-400">
                {t('scoring.rounds.label', { current: String(currentRound) })}
              </span>
              <span className="rounded-full border border-slate-600 bg-slate-800 px-3 py-0.5 tabular-nums text-slate-200">
                <span style={{ color: sideStyle(config, 'red').border }}>{redRoundWins}</span>
                <span className="mx-1 text-slate-500">–</span>
                <span style={{ color: sideStyle(config, 'blue').border }}>{blueRoundWins}</span>
              </span>
            </div>
          )}

          {/* Double-count X/Y chip + Double button */}
          <div className="flex flex-col items-center gap-1 mt-2 w-full">
            <span
              title={t('scoring.lice.doubleLimitTooltip')}
              className={`rounded-full px-3 py-0.5 text-xs font-bold tabular-nums ${doubleChipTone}`}
            >
              {doubleCount}/{maxDoubles ?? '∞'}
            </span>
            <button
              type="button"
              disabled={!canScore || submit.submitting}
              onClick={() => submit.submitDouble()}
              className="w-full max-w-[280px] min-h-[48px] rounded-xl border-2 border-amber-700 bg-amber-950 px-4 py-2 text-sm font-bold text-amber-200 hover:bg-amber-900 active:bg-amber-800 disabled:opacity-40"
            >
              ⚔ {t('scoring.lice.eventRowDouble')}
            </button>
            <button
              type="button"
              disabled={!canScore || submit.submitting}
              onClick={() => submit.submitNoExchange('other')}
              className="w-full max-w-[280px] min-h-[48px] rounded-xl border-2 border-gray-600 bg-gray-800 px-4 py-2 text-sm font-bold text-gray-200 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-40"
            >
              ⏸ {t('scoring.lice.eventRowNoExchange')}
            </button>
          </div>

          {/* Exchanges count + Clear last exchange */}
          <div className="flex flex-col items-center gap-1 mt-3 w-full">
            <p className="text-xs text-gray-500">
              {t('scoring.lice.exchangesCount', { count: String(events.length) })}
            </p>
            <button
              type="button"
              disabled={activeExchanges.length === 0 || clearBusy}
              onClick={() => void clearLastExchange()}
              className="w-full max-w-[280px] min-h-[48px] rounded-xl border-2 border-cyan-700 bg-cyan-950 px-4 py-2 text-sm font-bold text-cyan-200 hover:bg-cyan-900 active:bg-cyan-800 disabled:opacity-40 touch-manipulation"
            >
              ↶ {t('scoring.corrections.clearLastExchange')}
            </button>
          </div>
        </>
      )}

      {/* Events list — scrollable unified timeline */}
      <div className="w-full mt-3">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-1.5 text-center">
          {t('scoring.lice.eventsHeader')}
        </p>
        <div
          ref={eventsListRef}
          className="max-h-[260px] overflow-y-auto rounded-lg border border-gray-800 bg-gray-950 p-2 space-y-1"
        >
          {events.length === 0 && <p className="text-center text-xs text-gray-600 py-2">—</p>}
          {events.map((ev) => (
            <div key={ev.id} className="flex items-center gap-2 text-sm py-0.5">
              <span className="font-mono text-gray-500 tabular-nums w-7 flex-shrink-0">
                #{ev.number}
              </span>
              <span className="font-mono text-gray-400 tabular-nums">{ev.timeLabel}</span>
              {ev.sideColor && (
                <span
                  className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: ev.sideColor }}
                />
              )}
              <span className="font-semibold text-gray-100 truncate flex-1">{ev.fighterLabel}</span>
              {ev.card && (
                <span
                  title={ev.card}
                  className={`inline-block h-3.5 w-3.5 rounded-sm flex-shrink-0 ${CARD_CHIP_COLOR[ev.card]}`}
                />
              )}
              {ev.icon && (
                <span className="text-amber-300" aria-hidden>
                  {ev.icon}
                </span>
              )}
              <span className="text-gray-400 truncate">{ev.typeLabel}</span>
              {ev.delta && <span className="font-bold text-white">{ev.delta}</span>}
              {ev.opponentDelta && (
                <span className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-gray-600">·</span>
                  {ev.opponentSideColor && (
                    <span
                      className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: ev.opponentSideColor }}
                    />
                  )}
                  {ev.opponentLabel && (
                    <span className="text-gray-400 truncate max-w-[6rem]">{ev.opponentLabel}</span>
                  )}
                  <span className="font-bold text-white">{ev.opponentDelta}</span>
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Spacebar hint (when idle) */}
      {!readOnly && status === 'idle' && (
        <p className="mt-2 text-[10px] text-gray-600">{t('scoring.lice.spacebarHint')}</p>
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
        classes: 'border-green-600 bg-green-700 text-white hover:bg-green-800 active:bg-green-900',
      };
    case 'running':
      return {
        action: 'halt',
        labelKey: 'scoring.clock.pauseShort',
        icon: '⏸',
        classes:
          'border-yellow-600 bg-yellow-700 text-white hover:bg-yellow-800 active:bg-yellow-900',
      };
    case 'halted':
      return {
        action: 'resume',
        labelKey: 'scoring.clock.resume',
        icon: '▶',
        classes: 'border-green-600 bg-green-700 text-white hover:bg-green-800 active:bg-green-900',
      };
    case 'ended':
      return {
        action: 'reopen',
        labelKey: 'scoring.clock.reopen',
        icon: '↻',
        classes: 'border-gray-600 bg-gray-700 text-white hover:bg-gray-600 active:bg-gray-500',
      };
    default:
      return null;
  }
}

// ── Event list ────────────────────────────────────────────────────

// Card → swatch colour for the timeline penalty icon. Mirrors the
// per-side counter chips in ScoringColumn (not exported there; a 3-entry
// dup is cleaner than widening that component's public surface).
const CARD_CHIP_COLOR: Record<PenaltyCard, string> = {
  yellow: 'bg-yellow-500',
  red: 'bg-red-600',
  black: 'bg-gray-900 border border-gray-600',
};
