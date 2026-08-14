'use client';

import { useEffect, useRef, useState } from 'react';
import { formatInZone, localeToBcp47, minutesIntoDayInZone } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';

interface LiveMatch {
  id: string;
  matchNumberLabel: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  scheduledAt: string | null;
  status: string;
  tournamentName: string | null;
}

interface LiveLiceState {
  lice: { id: string; name: string; sortOrder: number };
  runningMatch: LiveMatch | null;
  nextMatch: LiveMatch | null;
}

interface LiveState {
  currentBlock: { label: string; startTime: string; endTime: string } | null;
  nextBlock: { label: string; startTime: string } | null;
  lices: LiveLiceState[];
  timezone: string;
}

/**
 * Minutes left in the current block, both sides read on the EVENT's clock.
 *
 * `endTime` is a wall-clock `HH:MM` with no offset. This used to `setHours`
 * it onto a browser-local `new Date()` and subtract, so a viewer in another
 * zone saw the offset instead of the remaining time — "480 min left" on a
 * block with two hours to run, and it kept counting for hours after the block
 * had ended.
 */
function minutesRemaining(endTime: string, nowIso: string, tz: string): number {
  const nowMinutes = minutesIntoDayInZone(nowIso, tz);
  if (nowMinutes === null) return 0;
  const [h, m] = endTime.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0) - nowMinutes;
}

export function LiveNowBanner({ eventId }: { eventId: string }) {
  const { t, locale } = useI18n();
  const apiUrl = getPublicApiUrl();
  const [state, setState] = useState<LiveState | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchState() {
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/live-state`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (res.ok) setState((await res.json()) as LiveState);
    } catch {
      // Keep last known state
    }
  }

  useEffect(() => {
    const initialTimer = setTimeout(() => void fetchState(), 0);
    intervalRef.current = setInterval(() => void fetchState(), 15_000);
    return () => {
      clearTimeout(initialTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  if (!state) return null;

  const hasActivity =
    state.currentBlock !== null || state.lices.some((l) => l.runningMatch !== null);
  if (!hasActivity && !state.nextBlock) return null;

  const blockLabel =
    state.currentBlock?.label ??
    (state.nextBlock
      ? t('organizer.schedulePage.liveBanner.nextBlock', { label: state.nextBlock.label })
      : null);
  const anyRunning = state.lices.some((l) => l.runningMatch !== null);
  const remaining = state.currentBlock
    ? minutesRemaining(state.currentBlock.endTime, new Date().toISOString(), state.timezone)
    : null;

  return (
    <div className="bg-surface border border-border rounded-xl mb-4 overflow-hidden shadow-sm">
      {/* Header row */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-background transition-colors"
      >
        <div className="flex items-center gap-2">
          {anyRunning && (
            <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              {t('organizer.schedulePage.liveBanner.live')}
            </span>
          )}
          {blockLabel && <span className="text-sm font-medium text-foreground">{blockLabel}</span>}
          {remaining !== null && (
            <span className="text-xs text-muted">
              {remaining <= 0
                ? t('organizer.schedulePage.liveBanner.ending')
                : t('organizer.schedulePage.liveBanner.minLeft', { min: remaining })}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-muted transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded lice rows */}
      {!collapsed && state.lices.length > 0 && (
        <div className="border-t border-border divide-y divide-border">
          {state.lices.map((ls) => (
            <div key={ls.lice.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-20 flex-shrink-0 font-medium text-foreground-secondary truncate text-xs">
                {ls.lice.name}
              </span>
              {ls.runningMatch ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="font-semibold text-foreground flex-shrink-0">
                    {ls.runningMatch.matchNumberLabel}
                  </span>
                  <span className="text-muted truncate">
                    {t('organizer.schedulePage.liveBanner.versus', {
                      a: ls.runningMatch.redFighterName ?? '?',
                      b: ls.runningMatch.blueFighterName ?? '?',
                    })}
                  </span>
                </div>
              ) : ls.nextMatch ? (
                <div className="flex items-center gap-2 min-w-0 text-muted">
                  <span className="flex-shrink-0 text-xs">
                    {t('organizer.schedulePage.liveBanner.nextShort')}
                  </span>
                  <span className="font-medium text-foreground-secondary flex-shrink-0">
                    {ls.nextMatch.matchNumberLabel}
                  </span>
                  <span className="truncate">
                    {t('organizer.schedulePage.liveBanner.versus', {
                      a: ls.nextMatch.redFighterName ?? '?',
                      b: ls.nextMatch.blueFighterName ?? '?',
                    })}
                  </span>
                  {ls.nextMatch.scheduledAt && (
                    <span className="flex-shrink-0 text-xs ml-auto">
                      {formatInZone(
                        ls.nextMatch.scheduledAt,
                        state.timezone,
                        { hour: '2-digit', minute: '2-digit' },
                        localeToBcp47(locale),
                      )}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-muted text-xs">–</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
