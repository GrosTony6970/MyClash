'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ClockStatus = 'idle' | 'running' | 'halted' | 'ended';

export interface ClockState {
  matchId: string;
  status: ClockStatus;
  activeMs: number;
  runningFrom: string | null;
  totalActiveMs: number;
}

interface MatchClockProps {
  matchId: string;
  apiUrl: string;
  /** Called after every clock action with the new state */
  onStateChange?: (state: ClockState) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Compute current display time from server state + local drift correction.
 * This is the key AC: clock recomputes from match_events timeline on every render.
 */
function computeDisplayMs(state: ClockState): number {
  if (state.status !== 'running' || !state.runningFrom) {
    return state.activeMs;
  }
  const elapsed = Date.now() - new Date(state.runningFrom).getTime();
  return state.activeMs + elapsed;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MatchClock({ matchId, apiUrl, onStateChange }: MatchClockProps) {
  const [clockState, setClockState] = useState<ClockState | null>(null);
  const [displayMs, setDisplayMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch clock state from server ─────────────────────────────────────────
  // AC: reload preserves clock state from server

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/clock`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const state = (await res.json()) as ClockState;
      setClockState(state);
      setDisplayMs(computeDisplayMs(state));
      onStateChange?.(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clock');
    }
  }, [matchId, apiUrl, onStateChange]);

  // Load on mount — fetchState is async, setState calls happen inside the async fn
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, setState in callback
    void fetchState();
  }, [fetchState]);

  // ── Tick: drift correction every 100ms ────────────────────────────────────
  // AC: clock recomputes from match_events timeline on every render

  useEffect(() => {
    if (clockState?.status === 'running') {
      tickRef.current = setInterval(() => {
        setDisplayMs(computeDisplayMs(clockState));
      }, 100);
    } else {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      if (clockState) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- sync update to display time when clock stops
        setDisplayMs(computeDisplayMs(clockState));
      }
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [clockState]);

  // ── Clock action ──────────────────────────────────────────────────────────

  const doAction = useCallback(async (action: string, reason?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/clock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, reason }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `Action ${action} failed`);
      }
      const newState = (await res.json()) as ClockState;
      setClockState(newState);
      setDisplayMs(computeDisplayMs(newState));
      onStateChange?.(newState);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clock action failed');
    } finally {
      setLoading(false);
    }
  }, [matchId, apiUrl, onStateChange]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!clockState) {
    return (
      <div className="flex items-center justify-center h-32">
        <p className="text-gray-500 text-sm">Loading clock…</p>
      </div>
    );
  }

  const { status } = clockState;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Clock display */}
      <div className={`text-7xl font-black tabular-nums tracking-tight ${
        status === 'running' ? 'text-white' :
        status === 'halted'  ? 'text-yellow-400' :
        status === 'ended'   ? 'text-gray-500' :
        'text-gray-600'
      }`}>
        {formatMs(displayMs)}
      </div>

      {/* Status badge */}
      <div className={`text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full ${
        status === 'running' ? 'bg-green-900 text-green-300' :
        status === 'halted'  ? 'bg-yellow-900 text-yellow-300' :
        status === 'ended'   ? 'bg-gray-800 text-gray-400' :
        'bg-gray-800 text-gray-500'
      }`}>
        {status}
      </div>

      {/* Error */}
      {error && (
        <p className="text-red-400 text-sm text-center">{error}</p>
      )}

      {/* Action buttons */}
      <div className="flex gap-3 flex-wrap justify-center">
        {status === 'idle' && (
          <ClockButton
            label="Start"
            color="green"
            disabled={loading}
            onClick={() => void doAction('start')}
          />
        )}
        {status === 'running' && (
          <>
            <ClockButton
              label="Halt"
              color="yellow"
              disabled={loading}
              onClick={() => void doAction('halt')}
            />
            <ClockButton
              label="End Match"
              color="red"
              disabled={loading}
              onClick={() => void doAction('end')}
            />
          </>
        )}
        {status === 'halted' && (
          <>
            <ClockButton
              label="Resume"
              color="green"
              disabled={loading}
              onClick={() => void doAction('resume')}
            />
            <ClockButton
              label="End Match"
              color="red"
              disabled={loading}
              onClick={() => void doAction('end')}
            />
            <ClockButton
              label="Reset"
              color="gray"
              disabled={loading}
              onClick={() => void doAction('reset_clock')}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ClockButton({
  label,
  color,
  disabled,
  onClick,
}: {
  label: string;
  color: 'green' | 'yellow' | 'red' | 'gray';
  disabled: boolean;
  onClick: () => void;
}) {
  const colors = {
    green:  'bg-green-700 hover:bg-green-600 active:bg-green-800',
    yellow: 'bg-yellow-700 hover:bg-yellow-600 active:bg-yellow-800',
    red:    'bg-red-700 hover:bg-red-600 active:bg-red-800',
    gray:   'bg-gray-700 hover:bg-gray-600 active:bg-gray-800',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${colors[color]} disabled:opacity-40 text-white font-bold py-3 px-6 rounded-xl text-lg transition-colors min-w-[120px]`}
    >
      {label}
    </button>
  );
}
