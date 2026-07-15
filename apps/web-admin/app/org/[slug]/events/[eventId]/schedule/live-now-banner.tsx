'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

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
}

function minutesRemaining(endTime: string): number {
  const now = new Date();
  const [h, m] = endTime.split(':').map(Number);
  const end = new Date(now);
  end.setHours(h ?? 0, m ?? 0, 0, 0);
  return Math.round((end.getTime() - now.getTime()) / 60_000);
}

export function LiveNowBanner({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
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
  const remaining = state.currentBlock ? minutesRemaining(state.currentBlock.endTime) : null;

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
                      red: ls.runningMatch.redFighterName ?? '?',
                      blue: ls.runningMatch.blueFighterName ?? '?',
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
                      red: ls.nextMatch.redFighterName ?? '?',
                      blue: ls.nextMatch.blueFighterName ?? '?',
                    })}
                  </span>
                  {ls.nextMatch.scheduledAt && (
                    <span className="flex-shrink-0 text-xs ml-auto">
                      {new Date(ls.nextMatch.scheduledAt).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })}
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
