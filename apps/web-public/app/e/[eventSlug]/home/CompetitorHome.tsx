/**
 * CompetitorHome — T-604
 * Persona: competitor / referee
 *
 * Shows: my next match, today's parcours (schedule), my last results.
 */

import Link from 'next/link';

interface Match {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  liceName: string | null;
  opponentName: string | null;
  redScore: number;
  blueScore: number;
}

interface Props {
  eventSlug: string;
  apiUrl: string;
}

async function fetchMyMatches(eventSlug: string, apiUrl: string): Promise<Match[]> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventSlug}/my-matches`, {
      cache: 'no-store',
      credentials: 'include',
    });
    if (!res.ok) return [];
    return (await res.json()) as Match[];
  } catch {
    return [];
  }
}

export async function CompetitorHome({ eventSlug, apiUrl }: Props) {
  const matches = await fetchMyMatches(eventSlug, apiUrl);

  const upcoming = matches.filter((m) => ['scheduled', 'running'].includes(m.status));
  const past = matches.filter((m) => m.status === 'completed').slice(0, 5);
  const nextMatch = upcoming[0] ?? null;

  return (
    <main className="flex flex-col gap-8 px-4 py-6 max-w-lg mx-auto">
      {/* Next match */}
      <section>
        <h2
          className="text-xs font-bold uppercase tracking-widest mb-3"
          style={{ color: 'var(--event-accent, #f59e0b)' }}
        >
          Next match
        </h2>
        {nextMatch ? (
          <Link href={`/e/${eventSlug}/match/${nextMatch.id}`}>
            <div
              className="rounded-xl border-2 p-5 transition-colors"
              style={{ borderColor: 'var(--event-primary, #c0392b)' }}
            >
              <p className="text-xs text-gray-400 mb-1">{nextMatch.matchNumberLabel}</p>
              <p className="text-xl font-bold text-white">vs {nextMatch.opponentName ?? 'TBD'}</p>
              {nextMatch.scheduledAt && (
                <p className="text-sm text-gray-400 mt-1">
                  {new Date(nextMatch.scheduledAt).toLocaleTimeString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {nextMatch.liceName && ` · ${nextMatch.liceName}`}
                </p>
              )}
              <span
                className="inline-block mt-3 text-xs font-bold px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor:
                    nextMatch.status === 'running' ? 'var(--event-primary, #c0392b)' : '#374151',
                  color: 'white',
                }}
              >
                {nextMatch.status === 'running' ? '● LIVE' : nextMatch.status}
              </span>
            </div>
          </Link>
        ) : (
          <div className="rounded-xl border border-gray-800 p-5 text-center">
            <p className="text-gray-500 text-sm">No upcoming matches</p>
          </div>
        )}
      </section>

      {/* Today's parcours */}
      {upcoming.length > 1 && (
        <section>
          <h2
            className="text-xs font-bold uppercase tracking-widest mb-3"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            Today&apos;s schedule
          </h2>
          <div className="flex flex-col gap-2">
            {upcoming.slice(1).map((m) => (
              <Link key={m.id} href={`/e/${eventSlug}/match/${m.id}`}>
                <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:border-gray-600 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-white">vs {m.opponentName ?? 'TBD'}</p>
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

      {/* Last results */}
      {past.length > 0 && (
        <section>
          <h2
            className="text-xs font-bold uppercase tracking-widest mb-3"
            style={{ color: 'var(--event-accent, #f59e0b)' }}
          >
            Recent results
          </h2>
          <div className="flex flex-col gap-2">
            {past.map((m) => (
              <Link key={m.id} href={`/e/${eventSlug}/match/${m.id}`}>
                <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:border-gray-600 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-white">vs {m.opponentName ?? 'TBD'}</p>
                    <p className="text-xs text-gray-500">{m.matchNumberLabel}</p>
                  </div>
                  <p className="text-lg font-black tabular-nums">
                    <span style={{ color: 'var(--event-primary, #c0392b)' }}>{m.redScore}</span>
                    <span className="text-gray-600 mx-1">–</span>
                    <span style={{ color: 'var(--color-blue-400, #60a5fa)' }}>{m.blueScore}</span>
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {matches.length === 0 && (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">⚔️</p>
          <p className="text-gray-400">Your matches will appear here once the schedule is set.</p>
        </div>
      )}
    </main>
  );
}
