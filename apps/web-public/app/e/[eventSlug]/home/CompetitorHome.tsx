/**
 * CompetitorHome — T-604
 * Persona: competitor / referee
 *
 * Shows: my next match, today's parcours (schedule), my last results.
 */

import Link from 'next/link';
import { EventBackLink } from './_components/EventBackLink';

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

async function fetchEventBranding(
  eventSlug: string,
  apiUrl: string,
): Promise<{ name: string; logoUrl: string | null } | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    return {
      name: String(raw['name'] ?? ''),
      logoUrl:
        typeof (raw['logo_url'] ?? raw['logoUrl']) === 'string'
          ? String(raw['logo_url'] ?? raw['logoUrl'])
          : null,
    };
  } catch {
    return null;
  }
}

export async function CompetitorHome({ eventSlug, apiUrl }: Props) {
  const [matches, branding] = await Promise.all([
    fetchMyMatches(eventSlug, apiUrl),
    fetchEventBranding(eventSlug, apiUrl),
  ]);

  const upcoming = matches.filter((m) => ['scheduled', 'running'].includes(m.status));
  const past = matches.filter((m) => m.status === 'completed').slice(0, 5);
  const nextMatch = upcoming[0] ?? null;

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-8 px-4 py-6">
      <EventBackLink />

      {branding && (branding.logoUrl || branding.name) && (
        <section className="flex items-center gap-3">
          {branding.logoUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={branding.logoUrl}
              alt=""
              className="h-14 w-14 rounded-lg border border-neutral-800 object-cover"
            />
          )}
          {branding.name && (
            <p className="font-display text-lg font-bold text-neutral-100">{branding.name}</p>
          )}
        </section>
      )}

      {/* Next match */}
      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-neutral-400">
          Next match
        </h2>
        {nextMatch ? (
          <Link
            href={`/e/${eventSlug}/match/${nextMatch.id}`}
            className="block rounded-xl border border-emerald-500/30 bg-neutral-900 p-5 transition-colors hover:border-emerald-400/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          >
            <p className="mb-1 text-xs text-neutral-400">{nextMatch.matchNumberLabel}</p>
            <p className="text-xl font-bold text-neutral-100">
              vs {nextMatch.opponentName ?? 'TBD'}
            </p>
            {nextMatch.scheduledAt && (
              <p className="mt-1 text-sm text-neutral-400">
                {new Date(nextMatch.scheduledAt).toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
                {nextMatch.liceName && ` · ${nextMatch.liceName}`}
              </p>
            )}
            <span
              className={[
                'mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold uppercase',
                nextMatch.status === 'running'
                  ? 'border border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                  : 'border border-neutral-700 bg-neutral-800 text-neutral-300',
              ].join(' ')}
            >
              {nextMatch.status === 'running' && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" />
              )}
              {nextMatch.status === 'running' ? 'LIVE' : nextMatch.status}
            </span>
          </Link>
        ) : (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5 text-center">
            <p className="text-sm text-neutral-500">No upcoming matches</p>
          </div>
        )}
      </section>

      {/* Today's parcours */}
      {upcoming.length > 1 && (
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-neutral-400">
            Today&apos;s schedule
          </h2>
          <div className="flex flex-col gap-2">
            {upcoming.slice(1).map((m) => (
              <Link
                key={m.id}
                href={`/e/${eventSlug}/match/${m.id}`}
                className="block rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 transition-colors hover:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-neutral-100">
                      vs {m.opponentName ?? 'TBD'}
                    </p>
                    <p className="text-xs text-neutral-500">{m.matchNumberLabel}</p>
                  </div>
                  {m.scheduledAt && (
                    <span className="rounded-md bg-neutral-800 px-2 py-1 text-xs font-mono text-neutral-300">
                      {new Date(m.scheduledAt).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })}
                    </span>
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
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-neutral-400">
            Recent results
          </h2>
          <div className="flex flex-col gap-2">
            {past.map((m) => (
              <Link
                key={m.id}
                href={`/e/${eventSlug}/match/${m.id}`}
                className="block rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 transition-colors hover:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-neutral-100">
                      vs {m.opponentName ?? 'TBD'}
                    </p>
                    <p className="text-xs text-neutral-500">{m.matchNumberLabel}</p>
                  </div>
                  <p className="text-lg font-black tabular-nums text-neutral-100">
                    <span className={m.redScore > m.blueScore ? 'text-emerald-400' : undefined}>
                      {m.redScore}
                    </span>
                    <span className="mx-1 text-neutral-600">–</span>
                    <span className={m.blueScore > m.redScore ? 'text-emerald-400' : undefined}>
                      {m.blueScore}
                    </span>
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {matches.length === 0 && (
        <div className="py-12 text-center">
          <p className="mb-3 text-4xl">⚔️</p>
          <p className="text-neutral-400">
            Your matches will appear here once the schedule is set.
          </p>
        </div>
      )}
    </main>
  );
}
