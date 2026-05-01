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
import type { AfterblowButton, CleanButton, TournamentScoringConfig } from '@myclash/types';
import { DEFAULT_SCORING_CONFIG, computeAfterblowDeltas } from '@myclash/types';

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
  onExchangeRecorded,
  onExchangeVoided,
}: ScoringPadProps) {
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

  // ── Submit ─────────────────────────────────────────────────────────────────

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
    [matchId, apiUrl, onExchangeRecorded],
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

  if (!scoringEnabled) {
    return (
      <div className="flex items-center justify-center p-6 text-center">
        <p className="text-gray-500 text-sm">Scoring not available — match not running</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 select-none">
      {/* Error */}
      {error && (
        <div className="bg-red-900 border border-red-600 text-red-200 rounded-lg px-4 py-2 text-sm text-center">
          {error}
          <button onClick={() => setError(null)} className="ml-3 underline text-red-300">
            Dismiss
          </button>
        </div>
      )}

      {/* ── Scoreboard + buttons under each fighter ── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Red side */}
        <div className="flex flex-col gap-2">
          {/* Fighter card */}
          <div className="bg-red-900 border-2 border-red-600 rounded-xl p-3 text-center">
            <p className="text-xs text-red-300 font-bold uppercase tracking-wide">Rouge</p>
            <p className="font-bold text-white text-base leading-tight mt-0.5 truncate">
              {redName}
            </p>
            <p className="text-5xl font-black text-red-300 mt-1 tabular-nums">{redScore}</p>
          </div>

          {/* Clean buttons */}
          {visibleClean.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {visibleClean.map((btn) => (
                <button
                  key={btn.label}
                  onClick={() => onClean('red', btn)}
                  disabled={submitting}
                  className="min-h-[56px] rounded-xl border-2 border-red-700 bg-red-950 text-red-200 font-black text-xl
                             hover:bg-red-900 active:bg-red-800 disabled:opacity-40 transition-colors touch-manipulation"
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
                  disabled={submitting}
                  className="min-h-[48px] rounded-xl border-2 border-orange-700 bg-orange-950 text-orange-200 font-bold text-sm
                             hover:bg-orange-900 active:bg-orange-800 disabled:opacity-40 transition-colors touch-manipulation"
                  title={
                    config.afterblowMode === 'deductive'
                      ? `Red +${btn.attackerPts}, Blue +0 (deductive)`
                      : `Red +${btn.attackerPts}, Blue +${btn.defenderPts}`
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
          <div className="bg-blue-900 border-2 border-blue-600 rounded-xl p-3 text-center">
            <p className="text-xs text-blue-300 font-bold uppercase tracking-wide">Bleu</p>
            <p className="font-bold text-white text-base leading-tight mt-0.5 truncate">
              {blueName}
            </p>
            <p className="text-5xl font-black text-blue-300 mt-1 tabular-nums">{blueScore}</p>
          </div>

          {/* Clean buttons */}
          {visibleClean.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {visibleClean.map((btn) => (
                <button
                  key={btn.label}
                  onClick={() => onClean('blue', btn)}
                  disabled={submitting}
                  className="min-h-[56px] rounded-xl border-2 border-blue-700 bg-blue-950 text-blue-200 font-black text-xl
                             hover:bg-blue-900 active:bg-blue-800 disabled:opacity-40 transition-colors touch-manipulation"
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
                  disabled={submitting}
                  className="min-h-[48px] rounded-xl border-2 border-orange-700 bg-orange-950 text-orange-200 font-bold text-sm
                             hover:bg-orange-900 active:bg-orange-800 disabled:opacity-40 transition-colors touch-manipulation"
                  title={
                    config.afterblowMode === 'deductive'
                      ? `Blue +${btn.attackerPts}, Red +0 (deductive)`
                      : `Blue +${btn.attackerPts}, Red +${btn.defenderPts}`
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
          disabled={submitting}
          className="min-h-[52px] rounded-xl border-2 border-orange-600 bg-orange-900 text-orange-100 font-bold
                     hover:bg-orange-800 active:bg-orange-700 disabled:opacity-40 transition-colors touch-manipulation"
        >
          Double
          <span className="block text-xs font-normal opacity-70">Double touche</span>
        </button>
        <button
          onClick={() => setShowNoExchange(true)}
          disabled={submitting}
          className="min-h-[52px] rounded-xl border-2 border-gray-600 bg-gray-800 text-gray-200 font-bold
                     hover:bg-gray-700 active:bg-gray-600 disabled:opacity-40 transition-colors touch-manipulation"
        >
          No exchange
          <span className="block text-xs font-normal opacity-70">Pas d&apos;échange</span>
        </button>
      </div>

      {/* Afterblow mode indicator */}
      <p className="text-center text-xs text-gray-600">
        Afterblow: <span className="font-medium text-gray-500">{config.afterblowMode}</span>
      </p>

      {/* Undo */}
      {undoAvailable && lastExchangeId && (
        <button
          onClick={() => void handleUndo()}
          disabled={submitting}
          className="w-full py-3 rounded-xl border-2 border-yellow-600 text-yellow-400 font-bold text-sm
                     hover:bg-yellow-900 active:bg-yellow-800 transition-colors disabled:opacity-50"
        >
          ↩ Undo last exchange (within 30s)
        </button>
      )}

      {/* Submitting */}
      {submitting && <p className="text-center text-gray-400 text-xs animate-pulse">Recording…</p>}

      {/* No-exchange reason picker */}
      {showNoExchange && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-sm p-4">
            <p className="text-sm font-bold text-white mb-3">Reason for no exchange</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'out_of_bounds' as const, label: 'Out of bounds', sub: 'Hors piste' },
                {
                  id: 'simultaneous_stop' as const,
                  label: 'Simultaneous stop',
                  sub: 'Arrêt simultané',
                },
                { id: 'no_valid_hit' as const, label: 'No valid hit', sub: 'Pas de touche valide' },
                { id: 'other' as const, label: 'Other', sub: 'Autre' },
              ].map((r) => (
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
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
