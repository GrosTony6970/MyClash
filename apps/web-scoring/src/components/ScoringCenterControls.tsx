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
import { sideStyle } from '../lib/side-color';
import { formatClockMs, type ClockState } from './MatchClock';
import { useExchanges, type ExchangeRow } from '../hooks/useExchanges';
import { usePenalties, type MatchPenalty } from '../hooks/usePenalties';
import type { UseScoringSubmitResult } from '../hooks/useScoringSubmit';

interface ScoringCenterControlsProps {
  matchId: string;
  apiUrl: string;
  matchFormat: MatchFormatConfig;
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
}

export function ScoringCenterControls({
  matchId,
  apiUrl,
  matchFormat,
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
}: ScoringCenterControlsProps) {
  const { t } = useI18n();
  const status = clockState?.status ?? 'idle';
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);

  // Live ticker so the timer doesn't freeze while running.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(id);
  }, [status]);

  const displayMs = useMemo(() => {
    if (!clockState) return 0;
    if (clockState.status === 'running' && clockState.runningFrom) {
      return clockState.activeMs + (now - new Date(clockState.runningFrom).getTime());
    }
    return clockState.activeMs;
  }, [clockState, now]);

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
  const doubleChipTone = (() => {
    if (maxDoubles === null) return 'bg-gray-800 text-gray-300';
    if (doubleCount >= maxDoubles) return 'bg-red-900 text-red-200 border border-red-500';
    if (doubleCount >= maxDoubles - 1) return 'bg-amber-900 text-amber-200 border border-amber-500';
    return 'bg-gray-800 text-gray-300';
  })();

  const events = useMemo(
    () =>
      mergeEvents(
        activeExchanges,
        activePenalties,
        redName,
        blueName,
        redRegistrationId,
        blueRegistrationId,
        t,
        config,
      ),
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
      {/* Status badge */}
      <span
        className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${
          status === 'running'
            ? 'bg-green-900 text-green-300'
            : status === 'halted'
              ? 'bg-yellow-900 text-yellow-300'
              : status === 'ended'
                ? 'bg-gray-800 text-gray-400'
                : 'bg-gray-800 text-gray-500'
        }`}
      >
        {status}
      </span>

      {/* Timer */}
      <p
        className={`font-mono text-6xl font-black tabular-nums leading-none ${
          status === 'running'
            ? 'text-white'
            : status === 'halted'
              ? 'text-yellow-400'
              : status === 'ended'
                ? 'text-gray-500'
                : 'text-gray-600'
        }`}
      >
        {formatClockMs(displayMs)}
      </p>

      {/* Total time */}
      {clockState?.startedAt && (
        <p className="text-xs uppercase tracking-widest text-gray-500">
          {t('scoring.clock.totalTime')} <span className="font-mono">{formatClockMs(totalMs)}</span>
        </p>
      )}

      {clockError && <p className="text-center text-xs text-red-400">{clockError}</p>}

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

      {/* Secondary row: End + Reset */}
      <div className="flex gap-2">
        {status !== 'idle' && status !== 'ended' && (
          <button
            type="button"
            disabled={clockLoading}
            onClick={() => onClockAction('end')}
            className="rounded-lg border-2 border-red-700 bg-red-950 px-4 py-1.5 text-sm font-bold text-red-200 hover:bg-red-900 active:bg-red-800 disabled:opacity-40"
          >
            {t('scoring.clock.endMatch')}
          </button>
        )}
        {status === 'halted' && (
          <button
            type="button"
            disabled={clockLoading}
            onClick={() => setResetConfirmOpen(true)}
            className="rounded-lg border-2 border-gray-600 bg-gray-800 px-4 py-1.5 text-sm font-bold text-gray-200 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-40"
          >
            {t('scoring.clock.reset')}
          </button>
        )}
      </div>

      {/* Reset confirmation dialog (inline, no @myclash/ui dep) */}
      {resetConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setResetConfirmOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-gray-700 bg-gray-900 p-5"
          >
            <h3 className="text-lg font-bold text-white">{t('scoring.clock.resetConfirmTitle')}</h3>
            <p className="mt-2 text-sm text-gray-300">{t('scoring.clock.resetConfirmBody')}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetConfirmOpen(false)}
                className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm font-bold text-gray-200"
              >
                {t('scoring.clock.resetConfirmCancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onClockAction('reset_clock');
                  setResetConfirmOpen(false);
                }}
                className="rounded-lg border border-red-600 bg-red-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-800"
              >
                {t('scoring.clock.resetConfirmAction')}
              </button>
            </div>
          </div>
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
          className="w-full max-w-[280px] rounded-xl border-2 border-amber-700 bg-amber-950 px-4 py-2 text-sm font-bold text-amber-200 hover:bg-amber-900 active:bg-amber-800 disabled:opacity-40"
        >
          ⚠ Double
        </button>
        <button
          type="button"
          disabled={!canScore || submit.submitting}
          onClick={() => submit.submitNoExchange('other')}
          className="w-full max-w-[280px] rounded-xl border-2 border-gray-600 bg-gray-800 px-4 py-2 text-sm font-bold text-gray-200 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-40"
        >
          ⏸ {t('scoring.lice.eventRowNoExchange')}
        </button>
      </div>

      {/* Exchanges count + Clear last exchange */}
      <div className="flex flex-col items-center gap-1 mt-3 w-full">
        <p className="text-xs text-gray-500">
          {t('scoring.lice.exchangesCount', { count: String(activeExchanges.length) })}
        </p>
        <button
          type="button"
          disabled={activeExchanges.length === 0 || clearBusy}
          onClick={() => void clearLastExchange()}
          className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-bold text-gray-300 hover:border-gray-500 disabled:opacity-40"
        >
          ↶ {t('scoring.corrections.clearLastExchange')}
        </button>
      </div>

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
            <div key={ev.id} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-gray-500 tabular-nums">{ev.timeLabel}</span>
              {ev.sideColor && (
                <span
                  className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: ev.sideColor }}
                />
              )}
              <span className="font-semibold text-gray-200 truncate flex-1">{ev.fighterLabel}</span>
              <span className="text-gray-400">{ev.typeLabel}</span>
              {ev.delta && <span className="font-bold text-white">{ev.delta}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Spacebar hint (when idle) */}
      {status === 'idle' && (
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

// ── Event list merge ──────────────────────────────────────────────

interface UnifiedEvent {
  id: string;
  occurredAt: string;
  timeLabel: string;
  sideColor: string | null;
  fighterLabel: string;
  typeLabel: string;
  delta: string | null;
}

function mergeEvents(
  exchanges: ExchangeRow[],
  penalties: MatchPenalty[],
  redName: string,
  blueName: string,
  redRegId: string,
  blueRegId: string,
  t: (k: string, p?: Record<string, string>) => string,
  config: TournamentScoringConfig,
): UnifiedEvent[] {
  const exchangeRows: UnifiedEvent[] = exchanges.map((e) => {
    const side: 'red' | 'blue' | null = e.scoringSide ?? null;
    const sideName = side === 'red' ? redName : side === 'blue' ? blueName : '—';
    const typeLabel =
      e.type === 'double'
        ? t('scoring.lice.eventRowDouble')
        : e.type === 'no_exchange'
          ? t('scoring.lice.eventRowNoExchange')
          : e.type === 'afterblow'
            ? 'AB'
            : 'clean';
    const delta = e.scoreDelta ? `+${e.scoreDelta}` : null;
    return {
      id: `ex-${e.id}`,
      occurredAt: e.occurredAt,
      timeLabel: shortTime(e.occurredAt),
      sideColor: side ? sideStyle(config, side).border : null,
      fighterLabel: e.type === 'double' ? t('scoring.lice.eventRowDouble') : sideName,
      typeLabel,
      delta,
    };
  });

  const penaltyRows: UnifiedEvent[] = penalties.map((p) => {
    const side: 'red' | 'blue' | null =
      p.registration_id === redRegId ? 'red' : p.registration_id === blueRegId ? 'blue' : null;
    const sideName = side === 'red' ? redName : side === 'blue' ? blueName : '—';
    return {
      id: `pen-${p.id}`,
      occurredAt: p.occurred_at ?? '',
      timeLabel: shortTime(p.occurred_at),
      sideColor: side ? sideStyle(config, side).border : null,
      fighterLabel: sideName,
      typeLabel: `${p.card} ${p.short_name ?? p.reason ?? ''}`.trim(),
      delta: p.score_delta ? String(p.score_delta) : null,
    };
  });

  return [...exchangeRows, ...penaltyRows].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

function shortTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
