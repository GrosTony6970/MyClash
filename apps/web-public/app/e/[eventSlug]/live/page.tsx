/* eslint-disable myclash/no-literal-string -- public live page, i18n tracked in backlog */
'use client';

import { useEffect, useRef, useState } from 'react';
import { getApiUrl } from '@/lib/api-url';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

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
  currentBlock: { label: string; startTime: string; endTime: string; blockType: string } | null;
  nextBlock: { label: string; startTime: string } | null;
  lices: LiveLiceState[];
}

function formatTime(hhmm: string): string {
  return hhmm.slice(0, 5);
}

function scheduledTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
      LIVE
    </span>
  );
}

function MatchCard({ match, label }: { match: LiveMatch; label: string }) {
  const isLive = match.status === 'running';
  return (
    <div
      className={[
        'rounded-xl p-3 border',
        isLive ? 'bg-red-950 border-red-700' : 'bg-gray-800 border-gray-700',
      ].join(' ')}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400 font-medium">{label}</span>
        {isLive ? (
          <LiveBadge />
        ) : match.scheduledAt ? (
          <span className="text-xs text-gray-500">{scheduledTime(match.scheduledAt)}</span>
        ) : null}
      </div>
      <p className="text-sm font-bold text-white">{match.matchNumberLabel}</p>
      <p className="text-sm text-gray-300 mt-0.5">
        {match.redFighterName ?? '?'} <span className="text-gray-500 text-xs">vs</span>{' '}
        {match.blueFighterName ?? '?'}
      </p>
      {match.tournamentName && <p className="text-xs text-gray-500 mt-1">{match.tournamentName}</p>}
    </div>
  );
}

export default function LivePage() {
  const params = useParams<{ eventSlug: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { eventSlug } = params;
  const focusLiceId = searchParams.get('lice');

  const apiUrl = getApiUrl();
  const [state, setState] = useState<LiveState | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchState() {
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventSlug}/live-state`, {
        cache: 'no-store',
      });
      if (res.ok) setState((await res.json()) as LiveState);
    } catch {
      // Keep last known state
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventSlug}/live-state`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) setState((await res.json()) as LiveState);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      })
      .finally(() => setLoading(false));

    timerRef.current = setInterval(() => void fetchState(), 30_000);
    return () => {
      controller.abort();
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventSlug]);

  // Realtime: re-fetch when any match on the event's lices changes
  useEffect(() => {
    if (!state?.lices.length) return;
    const liceIds = state.lices.map((l) => l.lice.id);

    const channels = liceIds.map((liceId) =>
      supabase
        .channel(`live-lice-${liceId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'matches',
            filter: `lice_id=eq.${liceId}`,
          },
          () => void fetchState(),
        )
        .subscribe(),
    );

    return () => {
      channels.forEach((ch) => void supabase.removeChannel(ch));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.lices.map((l) => l.lice.id).join(',')]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="text-4xl mb-3">📅</p>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-white mb-2">
            Schedule not available
          </h1>
          <p className="text-gray-400 text-sm">No live schedule data found for this event.</p>
        </div>
      </main>
    );
  }

  // ── Drill-down mode ────────────────────────────────────────────────────────
  if (focusLiceId) {
    const ls = state.lices.find((l) => l.lice.id === focusLiceId);
    if (!ls) {
      return (
        <main className="flex min-h-screen items-center justify-center px-4 text-center">
          <div>
            <p className="text-gray-400 text-sm">Lice not found.</p>
            <button
              onClick={() => router.push(`/e/${eventSlug}/live`)}
              className="mt-4 text-sm text-blue-400 hover:underline"
            >
              ← Back to overview
            </button>
          </div>
        </main>
      );
    }

    return (
      <main className="flex flex-col min-h-screen px-4 py-6 max-w-md mx-auto gap-4">
        <button
          onClick={() => router.push(`/e/${eventSlug}/live`)}
          className="text-sm text-gray-400 hover:text-white flex items-center gap-1 self-start"
        >
          ← All pistes
        </button>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Piste</p>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-white">{ls.lice.name}</h1>
        </div>

        {state.currentBlock && (
          <p className="text-sm text-gray-400">
            {state.currentBlock.label} · {formatTime(state.currentBlock.startTime)}–
            {formatTime(state.currentBlock.endTime)}
          </p>
        )}

        {ls.runningMatch ? (
          <MatchCard match={ls.runningMatch} label="Now fighting" />
        ) : (
          <div className="rounded-xl p-4 bg-gray-800 border border-gray-700 text-center">
            <p className="text-gray-400 text-sm">No active match</p>
          </div>
        )}

        {ls.nextMatch && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Up next
            </p>
            <MatchCard match={ls.nextMatch} label="Next" />
          </div>
        )}
      </main>
    );
  }

  // ── Overview mode ──────────────────────────────────────────────────────────
  const anyRunning = state.lices.some((l) => l.runningMatch !== null);

  return (
    <main className="flex flex-col min-h-screen px-4 py-6 max-w-2xl mx-auto gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
            Live schedule
          </p>
          {state.currentBlock ? (
            <>
              <h1 className="font-display font-bold text-2xl sm:text-3xl text-white">
                {state.currentBlock.label}
              </h1>
              <p className="text-sm text-gray-400 mt-0.5">
                {formatTime(state.currentBlock.startTime)}–{formatTime(state.currentBlock.endTime)}
              </p>
            </>
          ) : state.nextBlock ? (
            <>
              <h1 className="font-display font-bold text-2xl sm:text-3xl text-gray-400">
                Between sessions
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Next: {state.nextBlock.label} at {formatTime(state.nextBlock.startTime)}
              </p>
            </>
          ) : (
            <h1 className="font-display font-bold text-2xl sm:text-3xl text-gray-400">
              No active session
            </h1>
          )}
        </div>
        {anyRunning && <LiveBadge />}
      </div>

      {/* Lice grid */}
      {state.lices.length === 0 ? (
        <p className="text-gray-500 text-sm">No pistes configured for this event.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {state.lices.map((ls) => (
            <Link
              key={ls.lice.id}
              href={`/e/${eventSlug}/live?lice=${ls.lice.id}`}
              className="rounded-xl bg-gray-800 border border-gray-700 p-4 hover:border-gray-500 transition-colors block"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">
                  {ls.lice.name}
                </span>
                {ls.runningMatch && <LiveBadge />}
              </div>

              {ls.runningMatch ? (
                <div>
                  <p className="text-sm font-bold text-white">{ls.runningMatch.matchNumberLabel}</p>
                  <p className="text-sm text-gray-300 mt-0.5">
                    {ls.runningMatch.redFighterName ?? '?'}{' '}
                    <span className="text-gray-500 text-xs">vs</span>{' '}
                    {ls.runningMatch.blueFighterName ?? '?'}
                  </p>
                </div>
              ) : ls.nextMatch ? (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Next up</p>
                  <p className="text-sm font-medium text-gray-300">
                    {ls.nextMatch.matchNumberLabel}
                  </p>
                  <p className="text-sm text-gray-400">
                    {ls.nextMatch.redFighterName ?? '?'}{' '}
                    <span className="text-gray-500 text-xs">vs</span>{' '}
                    {ls.nextMatch.blueFighterName ?? '?'}
                  </p>
                  {ls.nextMatch.scheduledAt && (
                    <p className="text-xs text-gray-500 mt-1">
                      {scheduledTime(ls.nextMatch.scheduledAt)}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">–</p>
              )}
            </Link>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-600 text-center">Updates automatically</p>
    </main>
  );
}
