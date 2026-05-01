/**
 * AccompanistHome — T-604
 * Persona: accompanist
 *
 * Shows: favorites live, big matches.
 */

import Link from 'next/link';

interface FavoriteMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number;
  blueScore: number;
  liceName: string | null;
}

interface Props {
  eventSlug: string;
  apiUrl: string;
}

async function fetchFavoriteMatches(eventSlug: string, apiUrl: string): Promise<FavoriteMatch[]> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventSlug}/following/matches`, {
      cache: 'no-store',
      credentials: 'include',
    });
    if (!res.ok) return [];
    return (await res.json()) as FavoriteMatch[];
  } catch {
    return [];
  }
}

export async function AccompanistHome({ eventSlug, apiUrl }: Props) {
  const matches = await fetchFavoriteMatches(eventSlug, apiUrl);

  const live = matches.filter((m) => m.status === 'running');
  const upcoming = matches.filter((m) => m.status === 'scheduled');

  return (
    <main className="flex flex-col gap-8 px-4 py-6 max-w-lg mx-auto">
      {/* Live now */}
      {live.length > 0 && (
        <section>
          <h2
            className="text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2"
            style={{ color: 'var(--event-primary, #c0392b)' }}
          >
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block" />
            Live now
          </h2>
          <div className="flex flex-col gap-3">
            {live.map((m) => (
              <Link key={m.id} href={`/e/${eventSlug}/match/${m.id}`}>
                <div
                  className="rounded-xl border-2 p-4 transition-colors"
                  style={{ borderColor: 'var(--event-primary, #c0392b)' }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-400">{m.matchNumberLabel}</p>
                    {m.liceName && <p className="text-xs text-gray-500">{m.liceName}</p>}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-white">{m.redFighterName ?? '?'}</p>
                    <p className="text-2xl font-black tabular-nums">
                      <span style={{ color: 'var(--event-primary, #c0392b)' }}>{m.redScore}</span>
                      <span className="text-gray-600 mx-1.5">–</span>
                      <span style={{ color: 'var(--color-blue-400, #60a5fa)' }}>{m.blueScore}</span>
                    </p>
                    <p className="font-bold text-white">{m.blueFighterName ?? '?'}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Upcoming favorites */}
      {upcoming.length > 0 && (
        <section>
          <h2
            className="text-xs font-bold uppercase tracking-widest mb-3"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            Coming up
          </h2>
          <div className="flex flex-col gap-2">
            {upcoming.map((m) => (
              <Link key={m.id} href={`/e/${eventSlug}/match/${m.id}`}>
                <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:border-gray-600 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-white">
                      {m.redFighterName ?? '?'} vs {m.blueFighterName ?? '?'}
                    </p>
                    <p className="text-xs text-gray-500">{m.matchNumberLabel}</p>
                  </div>
                  {m.scheduledAt && (
                    <p className="text-sm text-gray-400">
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

      {/* Empty state */}
      {matches.length === 0 && (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">👥</p>
          <p className="text-gray-400 mb-4">Follow fighters to see their matches here.</p>
          <Link
            href={`/e/${eventSlug}/people`}
            className="text-sm underline"
            style={{ color: 'var(--event-primary, #c0392b)' }}
          >
            Browse participants →
          </Link>
        </div>
      )}
    </main>
  );
}
