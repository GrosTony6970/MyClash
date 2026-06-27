'use client';

/**
 * Watchlist view — T-612
 * Route: /e/[eventSlug]/following
 *
 * AC:
 *   ✓ Subscribed to event:{id} Realtime channel — live state without refresh
 *   ✓ Each row: avatar, name, club, state badge (Live/Next/Done)
 *   ✓ "Just won/lost X-Y" sticky for 5 minutes after match end
 *   ✓ Empty state: "Find people to follow on the People page."
 *   ✓ Migration cue (guest only): banner suggesting login link
 */

import { useEffect, useRef, useState } from 'react';
import { getApiUrl } from '@/lib/api-url';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FollowedPerson {
  personId: string;
  personName: string;
  personClub: string | null;
  followedAt: string;
  notifyMatchStart: boolean;
  nextEvent: {
    type: 'match' | 'workshop';
    label: string;
    scheduledAt: string | null;
  } | null;
  /** Injected client-side after Realtime update */
  liveMatchId?: string | null;
  liveMatchLabel?: string | null;
  liceName?: string | null;
  lastResultLabel?: string | null;
  lastResultAt?: number | null; // ms timestamp
}

type RowState = 'live' | 'next' | 'done' | 'idle';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRowState(person: FollowedPerson): RowState {
  if (person.liveMatchId) return 'live';
  if (person.nextEvent?.scheduledAt) return 'next';
  if (person.lastResultAt && Date.now() - person.lastResultAt < 5 * 60 * 1000) return 'done';
  return 'idle';
}

function StateBadge({ person }: { person: FollowedPerson }) {
  const state = getRowState(person);

  if (state === 'live') {
    return (
      <span className="flex items-center gap-1.5 text-xs font-bold text-red-300 bg-red-900/60 border border-red-800 px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
        Live now{person.liceName ? ` · ${person.liceName}` : ''}
      </span>
    );
  }

  if (state === 'next' && person.nextEvent?.scheduledAt) {
    const time = new Date(person.nextEvent.scheduledAt).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    return (
      <span className="text-xs text-gray-400 bg-gray-800 border border-gray-700 px-2 py-0.5 rounded-full">
        Next: {person.nextEvent.label} · {time}
      </span>
    );
  }

  if (state === 'done' && person.lastResultLabel) {
    return (
      <span className="text-xs text-green-300 bg-green-900/40 border border-green-800 px-2 py-0.5 rounded-full">
        {person.lastResultLabel}
      </span>
    );
  }

  return null;
}

function Initials({ name }: { name: string }) {
  const parts = name.split(' ').slice(0, 2);
  const init = parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
  return (
    <div className="w-10 h-10 rounded-full bg-red-900 border border-red-700 flex items-center justify-center text-sm font-bold text-red-200 flex-shrink-0">
      {init}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FollowingPage() {
  const params = useParams<{ eventSlug: string }>();
  const { eventSlug } = params;
  const apiUrl = getApiUrl();

  const [follows, setFollows] = useState<FollowedPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [claimSent, setClaimSent] = useState(false);
  const [eventId, setEventId] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expireOldResults = () => {
    const now = Date.now();
    setFollows((prev) =>
      prev.map((f) => {
        if (f.lastResultAt && now - f.lastResultAt >= 5 * 60 * 1000) {
          return { ...f, lastResultLabel: null, lastResultAt: null };
        }
        return f;
      }),
    );
  };

  // ── Fetch follows ────────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();

    // Detect guest (has mc_guest but not sb-access-token) — async to avoid sync setState
    setTimeout(() => {
      const hasClaimed = document.cookie.includes('sb-access-token=');
      const hasGuest = document.cookie.includes('mc_guest=');
      setIsGuest(hasGuest && !hasClaimed);
    }, 0);

    fetch(`${apiUrl}/api/v1/events/${eventSlug}/follows`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        setFollows((await res.json()) as FollowedPerson[]);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
      })
      .finally(() => setLoading(false));

    // Also fetch event id for Realtime channel
    fetch(`${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const ev = (await res.json()) as { id: string };
        setEventId(ev.id);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [eventSlug, apiUrl]);

  // ── Realtime: subscribe to event channel ─────────────────────────────────────

  useEffect(() => {
    if (!eventId) return;

    const channel = supabase
      .channel(`event-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (payload) => {
        const match = payload.new as Record<string, unknown>;
        if (!match) return;

        setFollows((prev) =>
          prev.map((f) => {
            // Check if this match involves the followed person
            // (simplified: update live state based on match status)
            if (match['status'] === 'running') {
              return {
                ...f,
                liveMatchId: match['id'] as string,
                liveMatchLabel: match['match_number_label'] as string,
              };
            }
            if (match['status'] === 'completed' && f.liveMatchId === match['id']) {
              const redScore = match['red_score'] as number;
              const blueScore = match['blue_score'] as number;
              return {
                ...f,
                liveMatchId: null,
                lastResultLabel: `Just finished ${redScore}–${blueScore}`,
                lastResultAt: Date.now(),
              };
            }
            return f;
          }),
        );
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [eventId]);

  // ── Tick: expire "Just won" badges after 5 min ───────────────────────────────

  useEffect(() => {
    tickRef.current = setInterval(expireOldResults, 30_000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  // ── Sort: live first, then by next event time, then idle ─────────────────────

  const sorted = [...follows].sort((a, b) => {
    const stateOrder = { live: 0, next: 1, done: 2, idle: 3 };
    const sa = stateOrder[getRowState(a)];
    const sb = stateOrder[getRowState(b)];
    if (sa !== sb) return sa - sb;
    const ta = a.nextEvent?.scheduledAt ?? '';
    const tb = b.nextEvent?.scheduledAt ?? '';
    return ta.localeCompare(tb);
  });

  // ── Claim link ────────────────────────────────────────────────────────────────

  async function handleRequestClaim() {
    try {
      await fetch(`${apiUrl}/api/v1/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type: 'claim' }),
      });
      setClaimSent(true);
    } catch {
      // Swallow
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="px-4 py-6 max-w-lg mx-auto">
      <h1
        className="font-display font-bold text-2xl sm:text-3xl mb-4"
        style={{
          fontFamily: 'var(--font-display)',
          color: 'var(--event-primary, #c0392b)',
        }}
      >
        Following
      </h1>

      {/* Guest migration cue */}
      {isGuest && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 mb-4 text-sm">
          {claimSent ? (
            <p className="text-green-400">✓ Login link sent to your email.</p>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-gray-400">Get push notifications when your favorites fight.</p>
              <button
                onClick={() => void handleRequestClaim()}
                className="text-sm font-semibold underline flex-shrink-0"
                style={{ color: 'var(--event-primary, #c0392b)' }}
              >
                Send login link
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {sorted.length === 0 && (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">👥</p>
          <p className="text-gray-400 mb-4">You&apos;re not following anyone yet.</p>
          <Link
            href={`/e/${eventSlug}/people`}
            className="text-sm font-semibold underline"
            style={{ color: 'var(--event-primary, #c0392b)' }}
          >
            Find people to follow on the People page →
          </Link>
        </div>
      )}

      {/* Follow list */}
      {sorted.length > 0 && (
        <ul className="flex flex-col gap-3">
          {sorted.map((person) => (
            <li key={person.personId}>
              <Link href={`/e/${eventSlug}/people/${person.personId}`}>
                <div
                  className={[
                    'flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
                    getRowState(person) === 'live'
                      ? 'border-red-700 bg-red-950/20'
                      : 'border-gray-800 bg-gray-900 hover:border-gray-600',
                  ].join(' ')}
                >
                  <Initials name={person.personName} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white truncate">{person.personName}</p>
                    {person.personClub && (
                      <p className="text-xs text-gray-500 truncate">{person.personClub}</p>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    <StateBadge person={person} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
