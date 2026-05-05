'use client';

/**
 * ScoringPad.tsx — Configurable score entry pad
 *
 * Buttons displayed directly under each fighter.
 * Tapping a button under Red → Red struck first.
 * Tapping a button under Blue → Blue struck first.
 *
 * Layout:
 *   ┌──────────────┐  VS  ┌──────────────┐
 *   │    Rouge      │      │    Bleu       │
 *   │     [3]       │      │     [1]       │
 *   └──────────────┘      └──────────────┘
 *     [+2] [+1]               [+2] [+1]
 *     [2-1] [1-1]             [2-1] [1-1]
 *
 *           [Double]  [No exchange]
 *
 * Afterblow modes:
 *   full      — attacker gets attackerPts, defender gets defenderPts
 *   deductive — attacker gets attackerPts, defender always gets 0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AfterblowButton,
  CleanButton,
  MatchFormatConfig,
  TournamentScoringConfig,
} from '@myclash/types';
import {
  DEFAULT_MATCH_FORMAT_CONFIG,
  DEFAULT_SCORING_CONFIG,
  computeAfterblowDeltas,
} from '@myclash/types';
import { useI18n } from '../i18n/I18nProvider';
import type { ClockState } from './MatchClock';

// ── Types ─────────────────────────────────────────────────────────────────────

type Color = 'red' | 'blue';
type NoExchangeReason = 'out_of_bounds' | 'simultaneous_stop' | 'no_valid_hit' | 'other';

interface PendingExchange {
  type: 'clean' | 'afterblow' | 'double' | 'no_exchange';
  firstStrikerColor?: Color;
  firstStrikeValue?: number;
  afterblowValue?: number;
  noExchangeReason?: NoExchangeReason;
}

const UNDO_WINDOW_MS = 30_000;

const SIDE_COLOR_STYLE = {
  white: { panel: '#f8fafc', border: '#cbd5e1', text: '#0f172a', muted: '#475569' },
  black: { panel: '#020617', border: '#334155', text: '#f8fafc', muted: '#cbd5e1' },
  grey: { panel: '#334155', border: '#64748b', text: '#f8fafc', muted: '#cbd5e1' },
  yellow: { panel: '#713f12', border: '#ca8a04', text: '#fef9c3', muted: '#fde68a' },
  red: { panel: '#7f1d1d', border: '#dc2626', text: '#fee2e2', muted: '#fca5a5' },
  blue: { panel: '#1e3a8a', border: '#2563eb', text: '#dbeafe', muted: '#93c5fd' },
  green: { panel: '#14532d', border: '#16a34a', text: '#dcfce7', muted: '#86efac' },
  brown: { panel: '#422006', border: '#92400e', text: '#ffedd5', muted: '#fdba74' },
  pink: { panel: '#831843', border: '#db2777', text: '#fce7f3', muted: '#f9a8d4' },
  orange: { panel: '#7c2d12', border: '#ea580c', text: '#ffedd5', muted: '#fdba74' },
  purple: { panel: '#581c87', border: '#9333ea', text: '#f3e8ff', muted: '#d8b4fe' },
} as const;

function isMedalMatchLabel(label: string | null | undefined) {
  const normalized = (label ?? '').trim().toUpperCase();
  return ['F', 'FINAL', 'GOLD', 'GOLD MEDAL MATCH', '3RD', 'BRONZE', 'BRONZE MEDAL MATCH'].includes(
    normalized,
  );
}

function remainingClockMs(
  matchFormat: MatchFormatConfig,
  phaseType: 'pool' | 'single_elim' | 'double_elim' | 'swiss' | undefined,
  matchNumberLabel: string | null,
  elapsedMs: number,
) {
  if (matchFormat.timerMode !== 'countdown') return null;
  const limitSeconds =
    phaseType === 'pool'
      ? matchFormat.timeLimitsSeconds.pool
      : isMedalMatchLabel(matchNumberLabel)
        ? matchFormat.timeLimitsSeconds.finals
        : matchFormat.timeLimitsSeconds.bracket;
  return limitSeconds === null ? null : Math.max(0, limitSeconds * 1000 - elapsedMs);
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ScoringPadProps {
  matchId: string;
  nextSequence: number;
  redName?: string;
  blueName?: string;
  redScore: number;
  blueScore: number;
  scoringEnabled?: boolean;
  apiUrl?: string;
  config?: TournamentScoringConfig;
  matchFormat?: MatchFormatConfig;
  phaseType?: 'pool' | 'single_elim' | 'double_elim' | 'swiss';
  matchNumberLabel?: string | null;
  /** Current clock state — scoring is only allowed when clock is halted */
  clockState?: ClockState | null;
  onExchangeRecorded?: (exchangeId: string) => void;
  onExchangeVoided?: (exchangeId: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ScoringPad({
  matchId,
  nextSequence,
  redName = 'Rouge',
  blueName = 'Bleu',
  redScore,
  blueScore,
  scoringEnabled = true,
  apiUrl = 'http://localhost:4000',
  config = DEFAULT_SCORING_CONFIG,
  matchFormat = DEFAULT_MATCH_FORMAT_CONFIG,
  phaseType,
  matchNumberLabel = null,
  clockState = null,
  onExchangeRecorded,
  onExchangeVoided,
}: ScoringPadProps) {
  const { t } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastExchangeId, setLastExchangeId] = useState<string | null>(null);
  const [lastExchangeAt, setLastExchangeAt] = useState<number | null>(null);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [showNoExchange, setShowNoExchange] = useState(false);
  const sequenceRef = useRef(nextSequence);

  useEffect(() => {
    sequenceRef.current = nextSequence;
  }, [nextSequence]);

  // ── Undo window ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!lastExchangeAt) {
      const t = setTimeout(() => setUndoAvailable(false), 0);
      return () => clearTimeout(t);
    }
    const remaining = UNDO_WINDOW_MS - (Date.now() - lastExchangeAt);
    if (remaining <= 0) {
      const t = setTimeout(() => setUndoAvailable(false), 0);
      return () => clearTimeout(t);
    }
    const t1 = setTimeout(() => setUndoAvailable(true), 0);
    const t2 = setTimeout(() => setUndoAvailable(false), remaining);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [lastExchangeAt]);

  // ── Clock guard ────────────────────────────────────────────────────────────
  // Scoring is only allowed when the clock is halted (not running).
  // This prevents accidental score entry during active fighting.
  const clockRunning = clockState?.status === 'running';
  const remainingMs = remainingClockMs(
    matchFormat,
    phaseType,
    matchNumberLabel,
    clockState?.activeMs ?? 0,
  );
  const softClockLocked =
    !clockRunning &&
    matchFormat.timerMode === 'countdown' &&
    matchFormat.softClockLimitSeconds > 0 &&
    remainingMs !== null &&
    remainingMs < matchFormat.softClockLimitSeconds * 1000;
  const canScore = scoringEnabled && !clockRunning && !softClockLocked;

  // Elapsed active ms at the moment of the last halt — recorded on each exchange
  const clockTimeMs = clockState?.activeMs ?? null;

  const submit = useCallback(
    async (exchange: PendingExchange) => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/exchanges`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            clientUuid: crypto.randomUUID(),
            sequence: sequenceRef.current,
            type: exchange.type,
            occurredAt: new Date().toISOString(),
            // Record elapsed clock time at moment of exchange entry (ms)
            clockTimeMs,
            firstStrikerColor: exchange.firstStrikerColor ?? null,
            firstStrikeValue: exchange.firstStrikeValue ?? null,
            afterblowValue: exchange.afterblowValue ?? null,
            noExchangeReason: exchange.noExchangeReason ?? null,
          }),
        });
        if (!res.ok) {
          const d = (await res.json()) as { message?: string };
          throw new Error(d.message ?? 'Failed');
        }
        const d = (await res.json()) as { id: string };
        setLastExchangeId(d.id);
        setLastExchangeAt(Date.now());
        onExchangeRecorded?.(d.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
      } finally {
        setSubmitting(false);
      }
    },
    [matchId, apiUrl, onExchangeRecorded, clockTimeMs],
  );

  // ── Undo ───────────────────────────────────────────────────────────────────

  const handleUndo = useCallback(async () => {
    if (!lastExchangeId) return;
    setSubmitting(true);
    try {
      await fetch(`${apiUrl}/api/v1/exchanges/${lastExchangeId}/void`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: 'Undo by scorekeeper' }),
      });
      const id = lastExchangeId;
      setLastExchangeId(null);
      setLastExchangeAt(null);
      setUndoAvailable(false);
      onExchangeVoided?.(id);
    } finally {
      setSubmitting(false);
    }
  }, [lastExchangeId, apiUrl, onExchangeVoided]);

  // ── Button handlers ────────────────────────────────────────────────────────

  function onClean(color: Color, btn: CleanButton) {
    void submit({ type: 'clean', firstStrikerColor: color, firstStrikeValue: btn.value });
  }

  function onAfterblowBtn(color: Color, btn: AfterblowButton) {
    const { attackerDelta, defenderDelta } = computeAfterblowDeltas(
      config.afterblowMode,
      btn.attackerPts,
      btn.defenderPts,
    );
    void submit({
      type: 'afterblow',
      firstStrikerColor: color,
      firstStrikeValue: attackerDelta,
      afterblowValue: defenderDelta,
    });
  }

  function onDouble() {
    void submit({ type: 'double' });
  }

  function onNoExchange(reason: NoExchangeReason) {
    setShowNoExchange(false);
    void submit({ type: 'no_exchange', noExchangeReason: reason });
  }

  // ── Visible buttons ────────────────────────────────────────────────────────

  const visibleClean = config.buttons.clean.filter((b) => b.visible);
  const visibleAfterblows = config.buttons.afterblow.filter((b) => b.visible);
  const redStyle = SIDE_COLOR_STYLE[config.display.sideColors.red];
  const blueStyle = SIDE_COLOR_STYLE[config.display.sideColors.blue];
  const redSideLabel = t('scoring.lice.red');
  const blueSideLabel = t('scoring.lice.blue');
  const noExchangeReasons = [
    {
      id: 'out_of_bounds' as const,
      label: t('scoring.pad.noExchangeReasons.outOfBounds'),
      sub: t('scoring.pad.noExchangeReasons.outOfBoundsFr'),
    },
    {
      id: 'simultaneous_stop' as const,
      label: t('scoring.pad.noExchangeReasons.simultaneousStop'),
      sub: t('scoring.pad.noExchangeReasons.simultaneousStopFr'),
    },
    {
      id: 'no_valid_hit' as const,
      label: t('scoring.pad.noExchangeReasons.noValidHit'),
      sub: t('scoring.pad.noExchangeReasons.noValidHitFr'),
    },
    {
      id: 'other' as const,
      label: t('scoring.pad.noExchangeReasons.other'),
      sub: t('scoring.pad.noExchangeReasons.otherFr'),
    },
  ];

  if (!scoringEnabled) {
    return (
      <div className="flex items-center justify-center p-6 text-center">
        <p className="text-gray-500 text-sm">{t('scoring.pad.scoringUnavailable')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 select-none">
      {/* Clock running banner — blocks scoring */}
      {clockRunning && (
        <div className="bg-yellow-900 border-2 border-yellow-500 text-yellow-200 rounded-xl px-4 py-3 text-center font-bold animate-pulse">
          {t('scoring.pad.clockRunning')}
        </div>
      )}

      {softClockLocked && (
        <div className="bg-orange-900 border-2 border-orange-500 text-orange-100 rounded-xl px-4 py-3 text-center font-bold">
          {t('scoring.lice.softClockLocked')}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900 border border-red-600 text-red-200 rounded-lg px-4 py-2 text-sm text-center">
          {error}
          <button onClick={() => setError(null)} className="ml-3 underline text-red-300">
            {t('actions.dismiss')}
          </button>
        </div>
      )}

      {/* ── Scoreboard + buttons under each fighter ── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Red side */}
        <div className="flex flex-col gap-2">
          {/* Fighter card */}
          <div
            className="border-2 rounded-xl p-3 text-center"
            style={{ backgroundColor: redStyle.panel, borderColor: redStyle.border }}
          >
            <p
              className="text-xs font-bold uppercase tracking-wide"
              style={{ color: redStyle.muted }}
            >
              {redSideLabel}
            </p>
            <p className="font-bold text-white text-base leading-tight mt-0.5 truncate">
              {redName}
            </p>
            <p className="text-5xl font-black mt-1 tabular-nums" style={{ color: redStyle.text }}>
              {redScore}
            </p>
          </div>

          {/* Clean buttons */}
          {visibleClean.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {visibleClean.map((btn) => (
                <button
                  key={btn.label}
                  onClick={() => onClean('red', btn)}
                  disabled={submitting || !canScore}
                  className="min-h-[56px] rounded-xl border-2 font-black text-xl disabled:opacity-40 transition-colors touch-manipulation"
                  style={{
                    backgroundColor: redStyle.panel,
                    borderColor: redStyle.border,
                    color: redStyle.text,
                  }}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          )}

          {/* Afterblow buttons */}
          {visibleAfterblows.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {visibleAfterblows.map((btn) => (
                <button
                  key={btn.label}
                  onClick={() => onAfterblowBtn('red', btn)}
                  disabled={submitting || !canScore}
                  className="min-h-[48px] rounded-xl border-2 border-orange-700 bg-orange-950 text-orange-200 font-bold text-sm
                             hover:bg-orange-900 active:bg-orange-800 disabled:opacity-40 transition-colors touch-manipulation"
                  title={
                    config.afterblowMode === 'deductive'
                      ? t('scoring.pad.afterblowTitleDeductive', {
                          attacker: redSideLabel,
                          defender: blueSideLabel,
                          attackerPts: btn.attackerPts,
                        })
                      : t('scoring.pad.afterblowTitleFull', {
                          attacker: redSideLabel,
                          defender: blueSideLabel,
                          attackerPts: btn.attackerPts,
                          defenderPts: btn.defenderPts,
                        })
                  }
                >
                  {btn.label}
                  <span className="block text-xs font-normal opacity-60">
                    {config.afterblowMode === 'deductive'
                      ? `+${btn.attackerPts} / 0`
                      : `+${btn.attackerPts} / +${btn.defenderPts}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Blue side */}
        <div className="flex flex-col gap-2">
          {/* Fighter card */}
          <div
            className="border-2 rounded-xl p-3 text-center"
            style={{ backgroundColor: blueStyle.panel, borderColor: blueStyle.border }}
          >
            <p
              className="text-xs font-bold uppercase tracking-wide"
              style={{ color: blueStyle.muted }}
            >
              {blueSideLabel}
            </p>
            <p className="font-bold text-white text-base leading-tight mt-0.5 truncate">
              {blueName}
            </p>
            <p className="text-5xl font-black mt-1 tabular-nums" style={{ color: blueStyle.text }}>
              {blueScore}
            </p>
          </div>

          {/* Clean buttons */}
          {visibleClean.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {visibleClean.map((btn) => (
                <button
                  key={btn.label}
                  onClick={() => onClean('blue', btn)}
                  disabled={submitting || !canScore}
                  className="min-h-[56px] rounded-xl border-2 font-black text-xl disabled:opacity-40 transition-colors touch-manipulation"
                  style={{
                    backgroundColor: blueStyle.panel,
                    borderColor: blueStyle.border,
                    color: blueStyle.text,
                  }}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          )}

          {/* Afterblow buttons */}
          {visibleAfterblows.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {visibleAfterblows.map((btn) => (
                <button
                  key={btn.label}
                  onClick={() => onAfterblowBtn('blue', btn)}
                  disabled={submitting || !canScore}
                  className="min-h-[48px] rounded-xl border-2 border-orange-700 bg-orange-950 text-orange-200 font-bold text-sm
                             hover:bg-orange-900 active:bg-orange-800 disabled:opacity-40 transition-colors touch-manipulation"
                  title={
                    config.afterblowMode === 'deductive'
                      ? t('scoring.pad.afterblowTitleDeductive', {
                          attacker: blueSideLabel,
                          defender: redSideLabel,
                          attackerPts: btn.attackerPts,
                        })
                      : t('scoring.pad.afterblowTitleFull', {
                          attacker: blueSideLabel,
                          defender: redSideLabel,
                          attackerPts: btn.attackerPts,
                          defenderPts: btn.defenderPts,
                        })
                  }
                >
                  {btn.label}
                  <span className="block text-xs font-normal opacity-60">
                    {config.afterblowMode === 'deductive'
                      ? `+${btn.attackerPts} / 0`
                      : `+${btn.attackerPts} / +${btn.defenderPts}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Shared: Double + No exchange ── */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onDouble}
          disabled={submitting || !canScore}
          className="min-h-[52px] rounded-xl border-2 border-orange-600 bg-orange-900 text-orange-100 font-bold
                     hover:bg-orange-800 active:bg-orange-700 disabled:opacity-40 transition-colors touch-manipulation"
        >
          {t('scoring.liveMatch.doubleTouch')}
          <span className="block text-xs font-normal opacity-70">
            {t('scoring.pad.doubleSubtitle')}
          </span>
        </button>
        <button
          onClick={() => setShowNoExchange(true)}
          disabled={submitting || !canScore}
          className="min-h-[52px] rounded-xl border-2 border-gray-600 bg-gray-800 text-gray-200 font-bold
                     hover:bg-gray-700 active:bg-gray-600 disabled:opacity-40 transition-colors touch-manipulation"
        >
          {t('scoring.liveMatch.noExchange')}
          <span className="block text-xs font-normal opacity-70">
            {t('scoring.pad.noExchangeSubtitle')}
          </span>
        </button>
      </div>

      {/* Afterblow mode indicator */}
      <p className="text-center text-xs text-gray-600">
        {t('scoring.pad.afterblowMode', { mode: config.afterblowMode })}
      </p>

      {/* Undo */}
      {undoAvailable && lastExchangeId && (
        <button
          onClick={() => void handleUndo()}
          disabled={submitting || !canScore}
          className="w-full py-3 rounded-xl border-2 border-yellow-600 text-yellow-400 font-bold text-sm
                     hover:bg-yellow-900 active:bg-yellow-800 transition-colors disabled:opacity-50"
        >
          {t('scoring.pad.undoLastExchange')}
        </button>
      )}

      {/* Submitting */}
      {submitting && (
        <p className="text-center text-gray-400 text-xs animate-pulse">
          {t('scoring.pad.recording')}
        </p>
      )}

      {/* No-exchange reason picker */}
      {showNoExchange && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-sm p-4">
            <p className="text-sm font-bold text-white mb-3">{t('scoring.pad.noExchangeReason')}</p>
            <div className="grid grid-cols-2 gap-2">
              {noExchangeReasons.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onNoExchange(r.id)}
                  className="min-h-[56px] rounded-xl border-2 border-gray-600 bg-gray-800 text-gray-200 font-medium text-sm
                             hover:bg-gray-700 active:bg-gray-600 transition-colors"
                >
                  {r.label}
                  <span className="block text-xs font-normal opacity-60">{r.sub}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowNoExchange(false)}
              className="mt-3 w-full text-sm text-gray-500 hover:text-gray-300"
            >
              {t('actions.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
