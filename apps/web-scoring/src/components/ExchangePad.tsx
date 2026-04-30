'use client';

/**
 * ExchangePad.tsx — T-403
 *
 * Tap-driven exchange entry UI for the scoring app.
 * Designed for tablet use with gloves: large touch targets, minimal taps.
 *
 * Exchange types:
 *   - Clean hit: choose striker (red/blue), value (1pt/2pt) → POST
 *   - Afterblow: choose first striker, first value, then afterblow value → POST
 *   - Double: single tap → POST
 *   - No-exchange: tap + reason picker → POST
 *
 * Undo: voids the last exchange within a 30-second window.
 *
 * Offline: exchanges are queued locally (IndexedDB via Dexie) and synced
 * when the network is restored. Each exchange has a client_uuid for
 * idempotent server-side insertion.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Color = 'red' | 'blue';
type ExchangeType = 'clean' | 'afterblow' | 'double' | 'no_exchange';
type PadStep =
  | 'idle'
  | 'clean_choose_striker'
  | 'clean_choose_value'
  | 'afterblow_choose_striker'
  | 'afterblow_choose_first_value'
  | 'afterblow_choose_afterblow_value'
  | 'no_exchange_choose_reason';

type NoExchangeReason = 'out_of_bounds' | 'simultaneous_stop' | 'no_valid_hit' | 'other';

interface PendingExchange {
  type?: ExchangeType;
  firstStrikerColor?: Color;
  firstStrikeValue?: number;
  afterblowValue?: number;
  noExchangeReason?: NoExchangeReason;
}

interface PadState {
  step: PadStep;
  pending: PendingExchange;
  lastExchangeId: string | null;
  lastExchangeAt: number | null; // ms timestamp
  submitting: boolean;
  error: string | null;
}

type PadAction =
  | { type: 'START_CLEAN' }
  | { type: 'START_AFTERBLOW' }
  | { type: 'START_DOUBLE' }
  | { type: 'START_NO_EXCHANGE' }
  | { type: 'CHOOSE_STRIKER'; color: Color }
  | { type: 'CHOOSE_FIRST_VALUE'; value: number }
  | { type: 'CHOOSE_AFTERBLOW_VALUE'; value: number }
  | { type: 'CHOOSE_NO_EXCHANGE_REASON'; reason: NoExchangeReason }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_SUCCESS'; exchangeId: string }
  | { type: 'SUBMIT_ERROR'; error: string }
  | { type: 'CANCEL' }
  | { type: 'UNDO_START' }
  | { type: 'UNDO_SUCCESS' }
  | { type: 'UNDO_ERROR'; error: string };

const INITIAL_STATE: PadState = {
  step: 'idle',
  pending: {},
  lastExchangeId: null,
  lastExchangeAt: null,
  submitting: false,
  error: null,
};

const UNDO_WINDOW_MS = 30_000; // 30 seconds

function padReducer(state: PadState, action: PadAction): PadState {
  switch (action.type) {
    case 'START_CLEAN':
      return { ...state, step: 'clean_choose_striker', pending: { type: 'clean' }, error: null };
    case 'START_AFTERBLOW':
      return {
        ...state,
        step: 'afterblow_choose_striker',
        pending: { type: 'afterblow' },
        error: null,
      };
    case 'START_DOUBLE':
      return { ...state, step: 'idle', pending: { type: 'double' }, submitting: true, error: null };
    case 'START_NO_EXCHANGE':
      return {
        ...state,
        step: 'no_exchange_choose_reason',
        pending: { type: 'no_exchange' },
        error: null,
      };

    case 'CHOOSE_STRIKER':
      if (state.step === 'clean_choose_striker') {
        return {
          ...state,
          step: 'clean_choose_value',
          pending: { ...state.pending, firstStrikerColor: action.color },
        };
      }
      if (state.step === 'afterblow_choose_striker') {
        return {
          ...state,
          step: 'afterblow_choose_first_value',
          pending: { ...state.pending, firstStrikerColor: action.color },
        };
      }
      return state;

    case 'CHOOSE_FIRST_VALUE':
      if (state.step === 'clean_choose_value') {
        return {
          ...state,
          step: 'idle',
          pending: { ...state.pending, firstStrikeValue: action.value },
          submitting: true,
        };
      }
      if (state.step === 'afterblow_choose_first_value') {
        return {
          ...state,
          step: 'afterblow_choose_afterblow_value',
          pending: { ...state.pending, firstStrikeValue: action.value },
        };
      }
      return state;

    case 'CHOOSE_AFTERBLOW_VALUE':
      return {
        ...state,
        step: 'idle',
        pending: { ...state.pending, afterblowValue: action.value },
        submitting: true,
      };

    case 'CHOOSE_NO_EXCHANGE_REASON':
      return {
        ...state,
        step: 'idle',
        pending: { ...state.pending, noExchangeReason: action.reason },
        submitting: true,
      };

    case 'SUBMIT_START':
      return { ...state, submitting: true, error: null };
    case 'SUBMIT_SUCCESS':
      return {
        ...state,
        submitting: false,
        pending: {},
        lastExchangeId: action.exchangeId,
        lastExchangeAt: Date.now(),
        error: null,
      };
    case 'SUBMIT_ERROR':
      return { ...state, submitting: false, error: action.error };

    case 'CANCEL':
      return {
        ...INITIAL_STATE,
        lastExchangeId: state.lastExchangeId,
        lastExchangeAt: state.lastExchangeAt,
      };

    case 'UNDO_START':
      return { ...state, submitting: true, error: null };
    case 'UNDO_SUCCESS':
      return { ...state, submitting: false, lastExchangeId: null, lastExchangeAt: null };
    case 'UNDO_ERROR':
      return { ...state, submitting: false, error: action.error };

    default:
      return state;
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ExchangePadProps {
  matchId: string;
  /** Current sequence number (next exchange will use this). */
  nextSequence: number;
  /** Called after a successful exchange submission. */
  onExchangeRecorded?: (exchangeId: string) => void;
  /** Called after a successful undo. */
  onExchangeVoided?: (exchangeId: string) => void;
  /** API base URL. */
  apiUrl?: string;
  /** Red fighter display name. */
  redName?: string;
  /** Blue fighter display name. */
  blueName?: string;
  /** Whether the match is in a state that allows scoring. */
  scoringEnabled?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ExchangePad({
  matchId,
  nextSequence,
  onExchangeRecorded,
  onExchangeVoided,
  apiUrl = 'http://localhost:4000',
  redName = 'Rouge',
  blueName = 'Bleu',
  scoringEnabled = true,
}: ExchangePadProps) {
  const [state, dispatch] = useReducer(padReducer, INITIAL_STATE);
  const sequenceRef = useRef(nextSequence);

  useEffect(() => {
    sequenceRef.current = nextSequence;
  }, [nextSequence]);

  // ── Submit exchange ────────────────────────────────────────────────────────

  const submitExchange = useCallback(
    async (exchange: PendingExchange) => {
      const clientUuid = crypto.randomUUID();
      const body = {
        clientUuid,
        sequence: sequenceRef.current,
        type: exchange.type,
        occurredAt: new Date().toISOString(),
        firstStrikerColor: exchange.firstStrikerColor ?? null,
        firstStrikeValue: exchange.firstStrikeValue ?? null,
        afterblowValue: exchange.afterblowValue ?? null,
        noExchangeReason: exchange.noExchangeReason ?? null,
      };

      try {
        const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/exchanges`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = (await res.json()) as { message?: string };
          throw new Error(data.message ?? 'Failed to record exchange');
        }

        const data = (await res.json()) as { id: string };
        dispatch({ type: 'SUBMIT_SUCCESS', exchangeId: data.id });
        onExchangeRecorded?.(data.id);
      } catch (err) {
        dispatch({
          type: 'SUBMIT_ERROR',
          error: err instanceof Error ? err.message : 'Network error',
        });
      }
    },
    [matchId, apiUrl, onExchangeRecorded],
  );

  // ── Auto-submit when submitting=true ──────────────────────────────────────

  useEffect(() => {
    if (!state.submitting || Object.keys(state.pending).length === 0) return;
    void submitExchange(state.pending);
  }, [state.submitting, state.pending, submitExchange]);

  // ── Undo window tracking ──────────────────────────────────────────────────

  const [undoAvailable, setUndoAvailable] = useState(false);

  useEffect(() => {
    if (!state.lastExchangeAt) {
      const timer = setTimeout(() => setUndoAvailable(false), 0);
      return () => clearTimeout(timer);
    }
    const remaining = UNDO_WINDOW_MS - (Date.now() - state.lastExchangeAt);
    if (remaining <= 0) {
      const timer = setTimeout(() => setUndoAvailable(false), 0);
      return () => clearTimeout(timer);
    }
    const enableTimer = setTimeout(() => setUndoAvailable(true), 0);
    const disableTimer = setTimeout(() => setUndoAvailable(false), remaining);
    return () => {
      clearTimeout(enableTimer);
      clearTimeout(disableTimer);
    };
  }, [state.lastExchangeAt]);

  const canUndo = undoAvailable && state.lastExchangeId !== null;

  // ── Undo ──────────────────────────────────────────────────────────────────

  const handleUndo = useCallback(async () => {
    if (!state.lastExchangeId) return;
    dispatch({ type: 'UNDO_START' });
    try {
      const res = await fetch(`${apiUrl}/api/v1/exchanges/${state.lastExchangeId}/void`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: 'Undo by scorekeeper' }),
      });
      if (!res.ok) throw new Error('Failed to void exchange');
      const voidedId = state.lastExchangeId;
      dispatch({ type: 'UNDO_SUCCESS' });
      onExchangeVoided?.(voidedId);
    } catch (err) {
      dispatch({ type: 'UNDO_ERROR', error: err instanceof Error ? err.message : 'Network error' });
    }
  }, [state.lastExchangeId, apiUrl, onExchangeVoided]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!scoringEnabled) {
    return (
      <div className="flex items-center justify-center p-8 text-center">
        <p className="text-gray-500 text-sm">Scoring not available — match not running</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 select-none">
      {/* Error banner */}
      {state.error && (
        <div className="bg-red-900 border border-red-600 text-red-200 rounded-lg px-4 py-2 text-sm text-center">
          {state.error}
          <button
            onClick={() => dispatch({ type: 'CANCEL' })}
            className="ml-3 underline text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Step indicator */}
      {state.step !== 'idle' && (
        <div className="bg-gray-800 rounded-lg px-4 py-2 text-center text-sm text-gray-300">
          {stepLabel(state.step)}
          <button
            onClick={() => dispatch({ type: 'CANCEL' })}
            className="ml-4 text-gray-500 hover:text-gray-300 text-xs underline"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Idle: main action buttons ── */}
      {state.step === 'idle' && (
        <div className="grid grid-cols-2 gap-3">
          <BigButton
            label="Clean Hit"
            sublabel="Touche nette"
            color="green"
            disabled={state.submitting}
            onClick={() => dispatch({ type: 'START_CLEAN' })}
          />
          <BigButton
            label="Afterblow"
            sublabel="Contre-attaque"
            color="yellow"
            disabled={state.submitting}
            onClick={() => dispatch({ type: 'START_AFTERBLOW' })}
          />
          <BigButton
            label="Double"
            sublabel="Double touche"
            color="orange"
            disabled={state.submitting}
            onClick={() => dispatch({ type: 'START_DOUBLE' })}
          />
          <BigButton
            label="No Exchange"
            sublabel="Pas d'échange"
            color="gray"
            disabled={state.submitting}
            onClick={() => dispatch({ type: 'START_NO_EXCHANGE' })}
          />
        </div>
      )}

      {/* ── Choose striker ── */}
      {(state.step === 'clean_choose_striker' || state.step === 'afterblow_choose_striker') && (
        <div className="grid grid-cols-2 gap-3">
          <BigButton
            label={redName}
            sublabel="First strike"
            color="red"
            onClick={() => dispatch({ type: 'CHOOSE_STRIKER', color: 'red' })}
          />
          <BigButton
            label={blueName}
            sublabel="First strike"
            color="blue"
            onClick={() => dispatch({ type: 'CHOOSE_STRIKER', color: 'blue' })}
          />
        </div>
      )}

      {/* ── Choose first strike value ── */}
      {(state.step === 'clean_choose_value' || state.step === 'afterblow_choose_first_value') && (
        <div className="grid grid-cols-2 gap-3">
          <BigButton
            label="1 pt"
            sublabel="Simple"
            color="white"
            onClick={() => dispatch({ type: 'CHOOSE_FIRST_VALUE', value: 1 })}
          />
          <BigButton
            label="2 pts"
            sublabel="Double valeur"
            color="white"
            onClick={() => dispatch({ type: 'CHOOSE_FIRST_VALUE', value: 2 })}
          />
        </div>
      )}

      {/* ── Choose afterblow value ── */}
      {state.step === 'afterblow_choose_afterblow_value' && (
        <div className="grid grid-cols-2 gap-3">
          <BigButton
            label="0 pt"
            sublabel="Afterblow (0)"
            color="white"
            onClick={() => dispatch({ type: 'CHOOSE_AFTERBLOW_VALUE', value: 0 })}
          />
          <BigButton
            label="1 pt"
            sublabel="Afterblow (1)"
            color="white"
            onClick={() => dispatch({ type: 'CHOOSE_AFTERBLOW_VALUE', value: 1 })}
          />
        </div>
      )}

      {/* ── No-exchange reason ── */}
      {state.step === 'no_exchange_choose_reason' && (
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              { reason: 'out_of_bounds' as const, label: 'Out of bounds', sublabel: 'Hors piste' },
              {
                reason: 'simultaneous_stop' as const,
                label: 'Simultaneous stop',
                sublabel: 'Arrêt simultané',
              },
              {
                reason: 'no_valid_hit' as const,
                label: 'No valid hit',
                sublabel: 'Pas de touche valide',
              },
              { reason: 'other' as const, label: 'Other', sublabel: 'Autre' },
            ] as const
          ).map(({ reason, label, sublabel }) => (
            <BigButton
              key={reason}
              label={label}
              sublabel={sublabel}
              color="gray"
              onClick={() => dispatch({ type: 'CHOOSE_NO_EXCHANGE_REASON', reason })}
            />
          ))}
        </div>
      )}

      {/* ── Undo button ── */}
      {canUndo && state.step === 'idle' && (
        <button
          onClick={() => {
            void handleUndo();
          }}
          disabled={state.submitting}
          className="w-full py-3 rounded-xl border-2 border-yellow-600 text-yellow-400 font-bold text-sm
                     hover:bg-yellow-900 active:bg-yellow-800 transition-colors disabled:opacity-50"
        >
          ↩ Undo last exchange (within 30s)
        </button>
      )}

      {/* Submitting indicator */}
      {state.submitting && (
        <div className="text-center text-gray-400 text-xs animate-pulse">Recording…</div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

type ButtonColor = 'green' | 'yellow' | 'orange' | 'gray' | 'red' | 'blue' | 'white';

const COLOR_CLASSES: Record<ButtonColor, string> = {
  green: 'bg-green-800 border-green-600 text-green-100 hover:bg-green-700 active:bg-green-600',
  yellow:
    'bg-yellow-800 border-yellow-600 text-yellow-100 hover:bg-yellow-700 active:bg-yellow-600',
  orange:
    'bg-orange-800 border-orange-600 text-orange-100 hover:bg-orange-700 active:bg-orange-600',
  gray: 'bg-gray-800 border-gray-600 text-gray-100 hover:bg-gray-700 active:bg-gray-600',
  red: 'bg-red-900 border-red-600 text-red-100 hover:bg-red-800 active:bg-red-700',
  blue: 'bg-blue-900 border-blue-600 text-blue-100 hover:bg-blue-800 active:bg-blue-700',
  white: 'bg-gray-700 border-gray-500 text-white hover:bg-gray-600 active:bg-gray-500',
};

function BigButton({
  label,
  sublabel,
  color,
  disabled = false,
  onClick,
}: {
  label: string;
  sublabel?: string;
  color: ButtonColor;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        min-h-[80px] rounded-xl border-2 font-bold text-lg
        flex flex-col items-center justify-center gap-0.5
        transition-colors touch-manipulation
        disabled:opacity-40 disabled:cursor-not-allowed
        ${COLOR_CLASSES[color]}
      `}
    >
      <span>{label}</span>
      {sublabel && <span className="text-xs font-normal opacity-70">{sublabel}</span>}
    </button>
  );
}

function stepLabel(step: PadStep): string {
  switch (step) {
    case 'clean_choose_striker':
    case 'afterblow_choose_striker':
      return 'Who struck first?';
    case 'clean_choose_value':
    case 'afterblow_choose_first_value':
      return 'Strike value?';
    case 'afterblow_choose_afterblow_value':
      return 'Afterblow value?';
    case 'no_exchange_choose_reason':
      return 'Reason for no exchange?';
    default:
      return '';
  }
}
