'use client';

import { useEffect, useRef, useState } from 'react';

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

function timeRemaining(endTime: string): string {
  const now = new Date();
  const [h, m] = endTime.split(':').map(Number);
  const end = new Date(now);
  end.setHours(h ?? 0, m ?? 0, 0, 0);
  const diffMin = Math.round((end.getTime() - now.getTime()) / 60_000);
  if (diffMin <= 0) return 'ending';
  return `${diffMin} min left`;
}

export function LiveNowBanner({ eventId }: { eventId: string }) {
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
    void fetchState();
    intervalRef.current = setInterval(() => void fetchState(), 15_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  if (!state) return null;

  const hasActivity =
    state.currentBlock !== null || state.lices.some((l) => l.runningMatch !== null);
  if (!hasActivity && !state.nextBlock) return null;

  const blockLabel =
    state.currentBlock?.label ?? (state.nextBlock ? `Next: ${state.nextBlock.label}` : null);
  const anyRunning = state.lices.some((l) => l.runningMatch !== null);

  return (
    <div className="bg-white border border-gray-200 rounded-xl mb-4 overflow-hidden shadow-sm">
      {/* Header row */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {anyRunning && (
            <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              LIVE
            </span>
          )}
          {blockLabel && <span className="text-sm font-medium text-gray-800">{blockLabel}</span>}
          {state.currentBlock && (
            <span className="text-xs text-gray-400">
              {timeRemaining(state.currentBlock.endTime)}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded lice rows */}
      {!collapsed && state.lices.length > 0 && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {state.lices.map((ls) => (
            <div key={ls.lice.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-20 flex-shrink-0 font-medium text-gray-600 truncate text-xs">
                {ls.lice.name}
              </span>
              {ls.runningMatch ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="font-semibold text-gray-900 flex-shrink-0">
                    {ls.runningMatch.matchNumberLabel}
                  </span>
                  <span className="text-gray-500 truncate">
                    {ls.runningMatch.redFighterName ?? '?'} vs{' '}
                    {ls.runningMatch.blueFighterName ?? '?'}
                  </span>
                </div>
              ) : ls.nextMatch ? (
                <div className="flex items-center gap-2 min-w-0 text-gray-400">
                  <span className="flex-shrink-0 text-xs">Next:</span>
                  <span className="font-medium text-gray-600 flex-shrink-0">
                    {ls.nextMatch.matchNumberLabel}
                  </span>
                  <span className="truncate">
                    {ls.nextMatch.redFighterName ?? '?'} vs {ls.nextMatch.blueFighterName ?? '?'}
                  </span>
                  {ls.nextMatch.scheduledAt && (
                    <span className="flex-shrink-0 text-xs ml-auto">
                      {new Date(ls.nextMatch.scheduledAt).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-gray-300 text-xs">–</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
