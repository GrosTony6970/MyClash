'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatchFormatConfig } from '@myclash/types';
import { DEFAULT_MATCH_FORMAT_CONFIG } from '@myclash/types';
import { clockStatusSemantic, statusPillTone } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { useScoringTheme } from '../theme/ThemeProvider';
import {
  type ClockState,
  displayClockMs,
  elapsedActiveMs,
  formatClockMs,
  shouldWarnClock,
} from './scoreboard-clock';
import { apiRequest } from '@myclash/api-client';
import { refusalMessage } from '../lib/refusal-copy';

// Pure clock math lives in ./scoreboard-clock (unit-tested). Re-export the
// helpers + types so existing `from './MatchClock'` imports keep resolving.
export type { ClockStatus, ClockState } from './scoreboard-clock';
export {
  formatClockMs,
  isMedalMatchLabel,
  effectiveTimeLimitSeconds,
  displayClockMs,
  shouldWarnClock,
} from './scoreboard-clock';

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
  const { padScope } = useScoringTheme();
  const [clockState, setClockState] = useState<ClockState | null>(null);
  const [displayMs, setDisplayMs] = useState(0);
  const [wallElapsedMs, setWallElapsedMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchState = useCallback(async () => {
    const result = await apiRequest<ClockState>(apiUrl, `/api/v1/matches/${matchId}/clock`);
    if (result.ok) {
      setClockState(result.data);
      setDisplayMs(elapsedActiveMs(result.data, Date.now()));
      onStateChange?.(result.data);
      return;
    }
    const message = refusalMessage(result, t, 'scoring.clock.loadFailed');
    if (message) setError(message);
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
        setDisplayMs(elapsedActiveMs(clockState, Date.now()));
        setWallElapsedMs(computeWallElapsedMs(clockState));
      }, 50);
    } else {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      if (clockState) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize displayed time when server clock stops
        setDisplayMs(elapsedActiveMs(clockState, Date.now()));
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
        const result = await apiRequest<ClockState>(apiUrl, `/api/v1/matches/${matchId}/clock`, {
          method: 'POST',
          body: { action, reason },
        });
        if (!result.ok) {
          throw new Error(refusalMessage(result, t, 'scoring.clock.actionFailed') ?? '');
        }
        const newState = result.data;
        setClockState(newState);
        setDisplayMs(elapsedActiveMs(newState, Date.now()));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onMatchChanged is excluded intentionally to avoid re-creating this handler / re-subscribing the clock.
    [matchId, apiUrl, onStateChange, t],
  );

  if (!clockState) {
    return (
      <div className="flex h-32 items-center justify-center">
        <p className="text-sm text-muted">{t('scoring.clock.loading')}</p>
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
        {formatClockMs(shownMs)}
      </div>

      {(() => {
        const tone = statusPillTone(clockStatusSemantic(status), padScope);
        return (
          <div
            className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-widest ${tone.className} ${
              tone.pulse ? 'animate-pulse' : ''
            }`}
          >
            {status}
          </div>
        );
      })()}

      {clockState.startedAt && clockState.status !== 'idle' && (
        <div className="flex items-center gap-2 text-muted">
          <span className="text-xs uppercase tracking-widest">{t('scoring.clock.totalTime')}</span>
          <span className="font-mono text-sm tabular-nums">{formatClockMs(wallElapsedMs)}</span>
        </div>
      )}

      {error && <p className="text-center text-sm text-danger">{error}</p>}

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
    green: 'bg-success hover:bg-success-hover active:bg-success-hover',
    yellow: 'bg-warning hover:bg-warning-hover active:bg-warning-hover',
    red: 'bg-danger hover:bg-danger-hover active:bg-danger-hover',
    gray: 'bg-border hover:bg-muted/50 active:bg-border',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${colors[color]} min-w-[120px] rounded-xl px-6 py-3 text-lg font-bold text-foreground transition-colors disabled:opacity-40`}
    >
      {label}
    </button>
  );
}
