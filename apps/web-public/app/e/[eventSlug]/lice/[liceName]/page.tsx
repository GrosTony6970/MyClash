'use client';

/**
 * Lice live view — T-606
 * Route: /e/[eventSlug]/lice/[liceName]
 *
 * Shows currently playing match + queue.
 * Auto-updates via Supabase Realtime when match status changes.
 *
 * AC:
 *   ✓ Auto-updates when current match changes
 *   ✓ Mobile-optimized vertical layout
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

interface LiceMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number;
  blueScore: number;
  tournamentName: string | null;
  rulesetCode: string;
}

interface LiceData {
  liceId: string;
  liceName: string;
  current: LiceMatch | null;
  queue: LiceMatch[];
}

export default function LicePage() {
  const params = useParams<{ eventSlug: string; liceName: string }>();
  const { eventSlug, liceName } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [data, setData] = useState<LiceData | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchLiceData() {
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/events/${eventSlug}/lices/${encodeURIComponent(liceName)}/current`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        setData(null);
        return;
      }
      setData((await res.json()) as LiceData);
    } catch {
      // Keep last known state
    } finally {
      setLoading(false);
    }
  }

  // Initial fetch
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventSlug}/lices/${encodeURIComponent(liceName)}/current`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          setData(null);
          return;
        }
        setData((await res.json()) as LiceData);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [eventSlug, liceName, apiUrl]);

  // Realtime: re-fetch when any match on this lice changes
  useEffect(() => {
    if (!data?.liceId) return;

    const channel = supabase
      .channel(`lice-${data.liceId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matches',
          filter: `lice_id=eq.${data.liceId}`,
        },
        () => void fetchLiceData(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.liceId]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="text-4xl mb-3">🏟️</p>
          <h1 className="text-xl font-bold text-white mb-2">Lice not found</h1>
          <p className="text-gray-400 text-sm">
            &ldquo;{liceName}&rdquo; is not a known Lice for this event.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col min-h-screen px-4 py-6 max-w-md mx-auto gap-6">
      {/* Header */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Lice</p>
        <h1
          className="text-2xl font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary, #c0392b)' }}
        >
          {data.liceName}
        </h1>
      </div>

      {/* Current match */}
      <section>
        <h2
          className="text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2"
          style={{
            color:
              data.current?.status === 'running'
                ? 'var(--event-primary, #c0392b)'
                : 'var(--event-accent, #f59e0b)',
          }}
        >
          {data.current?.status === 'running' && (
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          )}
          {data.current ? 'Now playing' : 'No match in progress'}
        </h2>

        {data.current ? (
          <Link href={`/e/${eventSlug}/match/${data.current.id}`}>
            <div
              className="rounded-xl border-2 p-5 transition-colors"
              style={{
                borderColor:
                  data.current.status === 'running' ? 'var(--event-primary, #c0392b)' : '#374151',
              }}
            >
              <p className="text-xs text-gray-400 mb-3">
                {data.current.tournamentName} · {data.current.matchNumberLabel} ·{' '}
                {data.current.rulesetCode}
              </p>

              {/* Scoreboard */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 text-center">
                  <p className="font-bold text-white text-lg leading-tight">
                    {data.current.redFighterName ?? '?'}
                  </p>
                  <p
                    className="text-5xl font-black tabular-nums mt-2"
                    style={{ color: 'var(--event-primary, #c0392b)' }}
                  >
                    {data.current.redScore}
                  </p>
                </div>
                <div className="text-gray-600 font-bold text-xl">–</div>
                <div className="flex-1 text-center">
                  <p className="font-bold text-white text-lg leading-tight">
                    {data.current.blueFighterName ?? '?'}
                  </p>
                  <p className="text-5xl font-black tabular-nums mt-2 text-blue-400">
                    {data.current.blueScore}
                  </p>
                </div>
              </div>
            </div>
          </Link>
        ) : (
          <div className="rounded-xl border border-gray-800 p-6 text-center">
            <p className="text-gray-500 text-sm">Waiting for next match…</p>
          </div>
        )}
      </section>

      {/* Queue */}
      {data.queue.length > 0 && (
        <section>
          <h2
            className="text-xs font-bold uppercase tracking-widest mb-3"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            Up next
          </h2>
          <div className="flex flex-col gap-2">
            {data.queue.map((m, idx) => (
              <Link key={m.id} href={`/e/${eventSlug}/match/${m.id}`}>
                <div className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:border-gray-600 transition-colors">
                  <span className="text-gray-600 font-bold text-sm w-5 text-center">{idx + 1}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">
                      {m.redFighterName ?? '?'} vs {m.blueFighterName ?? '?'}
                    </p>
                    <p className="text-xs text-gray-500">{m.matchNumberLabel}</p>
                  </div>
                  {m.scheduledAt && (
                    <p className="text-xs text-gray-400 flex-shrink-0">
                      {new Date(m.scheduledAt).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
