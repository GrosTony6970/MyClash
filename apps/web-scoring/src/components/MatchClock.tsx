'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatchFormatConfig } from '@myclash/types';
import { DEFAULT_MATCH_FORMAT_CONFIG } from '@myclash/types';
import { useI18n } from '../i18n/I18nProvider';

export type ClockStatus = 'idle' | 'running' | 'halted' | 'ended';

export interface ClockState {
  matchId: string;
  status: ClockStatus;
  activeMs: number;
  runningFrom: string | null;
  totalActiveMs: number;
  startedAt: string | null;
}

interface MatchClockProps {
  matchId: string;
  apiUrl: string;
  matchFormat?: MatchFormatConfig;
  phaseType?: 'pool' | 'single_elim' | 'double_elim' | 'swiss';
  matchNumberLabel?: string | null;
  disabled?: boolean;
  onStateChange?: (state: ClockState) => void;
  /**
   * Called after a successful clock action so the parent can refetch
   * the match row. Without this, gates like `scoringEnabled` keep
   * reading the original `match.status` from the initial load and
   * never re-enable scoring after a 'start' / 'resume' transition.
   */
  onMatchChanged?: () => void;
}

export function formatClockMs(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((clamped % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(
    centiseconds,
  ).padStart(2, '0')}`;
}

export function isMedalMatchLabel(label: string | null | undefined) {
  const normalized = (label ?? '').trim().toUpperCase();
  return ['F', 'FINAL', 'GOLD', 'GOLD MEDAL MATCH', '3RD', 'BRONZE', 'BRONZE MEDAL MATCH'].includes(
    normalized,
  );
}

export function phaseTimeLimitSeconds(
  matchFormat: MatchFormatConfig,
  phaseType: 'pool' | 'single_elim' | 'double_elim' | 'swiss' | undefined,
  matchNumberLabel: string | null | undefined,
) {
  if (phaseType === 'pool') return matchFormat.timeLimitsSeconds.pool;
  if (isMedalMatchLabel(matchNumberLabel)) return matchFormat.timeLimitsSeconds.finals;
  return matchFormat.timeLimitsSeconds.bracket;
}

export function displayClockMs(
  elapsedMs: number,
  matchFormat: MatchFormatConfig,
  phaseType: 'pool' | 'single_elim' | 'double_elim' | 'swiss' | undefined,
  matchNumberLabel: string | null | undefined,
) {
  const limitSeconds = phaseTimeLimitSeconds(matchFormat, phaseType, matchNumberLabel);
  if (matchFormat.timerMode === 'countdown' && limitSeconds !== null) {
    return Math.max(0, limitSeconds * 1000 - elapsedMs);
  }
  return elapsedMs;
}

export function shouldWarnClock(
  elapsedMs: number,
  matchFormat: MatchFormatConfig,
  phaseType: 'pool' | 'single_elim' | 'double_elim' | 'swiss' | undefined,
  matchNumberLabel: string | null | undefined,
) {
  const limitSeconds = phaseTimeLimitSeconds(matchFormat, phaseType, matchNumberLabel);
  if (limitSeconds === null) return false;
  return Math.max(0, limitSeconds * 1000 - elapsedMs) < 10_000;
}

function computeDisplayMs(state: ClockState): number {
  if (state.status !== 'running' || !state.runningFrom) {
    return state.activeMs;
  }
  const elapsed = Date.now() - new Date(state.runningFrom).getTime();
  return state.activeMs + elapsed;
}

function computeWallElapsedMs(state: ClockState): number {
  if (!state.startedAt) return 0;
  return Date.now() - new Date(state.startedAt).getTime();
}

export default function MatchClock({
  matchId,
  apiUrl,
  matchFormat = DEFAULT_MATCH_FORMAT_CONFIG,
  phaseType,
  matchNumberLabel,
  disabled = false,
  onStateChange,
  onMatchChanged,
}: MatchClockProps) {
  const { t } = useI18n();
  const [clockState, setClockState] = useState<ClockState | null>(null);
  const [displayMs, setDisplayMs] = useState(0);
  const [wallElapsedMs, setWallElapsedMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      setError(err instanceof Error ? err.message : t('scoring.clock.loadFailed'));
    }
  }, [matchId, apiUrl, onStateChange, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch updates state after server response
    void fetchState();
  }, [fetchState]);

  useEffect(() => {
    // Tick when running (fight clock) or when started-but-not-ended (wall clock keeps going when halted)
    const shouldTick =
      clockState?.startedAt && clockState.status !== 'idle' && clockState.status !== 'ended';
    if (shouldTick) {
      tickRef.current = setInterval(() => {
        setDisplayMs(computeDisplayMs(clockState));
        setWallElapsedMs(computeWallElapsedMs(clockState));
      }, 50);
    } else {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      if (clockState) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize displayed time when server clock stops
        setDisplayMs(computeDisplayMs(clockState));
        setWallElapsedMs(computeWallElapsedMs(clockState));
      }
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [clockState]);

  const doAction = useCallback(
    async (action: string, reason?: string) => {
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
          throw new Error(body.message ?? t('scoring.clock.actionFailed'));
        }
        const newState = (await res.json()) as ClockState;
        setClockState(newState);
        setDisplayMs(computeDisplayMs(newState));
        onStateChange?.(newState);
        // Trigger a parent refetch so `match.status` reflects the new
        // clock state. Gates downstream (scoringEnabled, penalty
        // picker disabled state) read `match.status` — without this
        // they stay stale until the next manual refresh.
        onMatchChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('scoring.clock.actionFailed'));
      } finally {
        setLoading(false);
      }
    },
    [matchId, apiUrl, onStateChange, t],
  );

  if (!clockState) {
    return (
      <div className="flex h-32 items-center justify-center">
        <p className="text-sm text-gray-500">{t('scoring.clock.loading')}</p>
      </div>
    );
  }

  const { status } = clockState;
  const warned = shouldWarnClock(displayMs, matchFormat, phaseType, matchNumberLabel);
  const shownMs = displayClockMs(displayMs, matchFormat, phaseType, matchNumberLabel);

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className={`text-7xl font-black tabular-nums tracking-tight ${
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
        {formatClockMs(shownMs)}
      </div>

      <div
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
      </div>

      {clockState.startedAt && clockState.status !== 'idle' && (
        <div className="flex items-center gap-2 text-gray-500">
          <span className="text-xs uppercase tracking-widest">{t('scoring.clock.totalTime')}</span>
          <span className="font-mono text-sm tabular-nums">{formatClockMs(wallElapsedMs)}</span>
        </div>
      )}

      {error && <p className="text-center text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap justify-center gap-3">
        {status === 'idle' && (
          <ClockButton
            label={t('scoring.clock.start')}
            color="green"
            disabled={loading || disabled}
            onClick={() => void doAction('start')}
          />
        )}
        {status === 'running' && (
          <>
            <ClockButton
              label={t('scoring.clock.halt')}
              color="yellow"
              disabled={loading || disabled}
              onClick={() => void doAction('halt')}
            />
            <ClockButton
              label={t('scoring.clock.endMatch')}
              color="red"
              disabled={loading || disabled}
              onClick={() => void doAction('end')}
            />
          </>
        )}
        {status === 'halted' && (
          <>
            <ClockButton
              label={t('scoring.clock.resume')}
              color="green"
              disabled={loading || disabled}
              onClick={() => void doAction('resume')}
            />
            <ClockButton
              label={t('scoring.clock.endMatch')}
              color="red"
              disabled={loading || disabled}
              onClick={() => void doAction('end')}
            />
            <ClockButton
              label={t('scoring.clock.reset')}
              color="gray"
              disabled={loading || disabled}
              onClick={() => void doAction('reset_clock')}
            />
          </>
        )}
      </div>
    </div>
  );
}

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
    green: 'bg-green-700 hover:bg-green-600 active:bg-green-800',
    yellow: 'bg-yellow-700 hover:bg-yellow-600 active:bg-yellow-800',
    red: 'bg-red-700 hover:bg-red-600 active:bg-red-800',
    gray: 'bg-gray-700 hover:bg-gray-600 active:bg-gray-800',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${colors[color]} min-w-[120px] rounded-xl px-6 py-3 text-lg font-bold text-white transition-colors disabled:opacity-40`}
    >
      {label}
    </button>
  );
}
