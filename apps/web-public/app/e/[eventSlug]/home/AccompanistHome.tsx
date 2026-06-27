/**
 * AccompanistHome — T-604
 * Persona: accompanist
 *
 * Shows: favorites live, big matches.
 */

import Link from 'next/link';
import { EventBackLink } from './_components/EventBackLink';

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

export async function AccompanistHome({ eventSlug, apiUrl }: Props) {
  const [matches, branding] = await Promise.all([
    fetchFavoriteMatches(eventSlug, apiUrl),
    fetchEventBranding(eventSlug, apiUrl),
  ]);

  const live = matches.filter((m) => m.status === 'running');
  const upcoming = matches.filter((m) => m.status === 'scheduled');

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
              className="h-14 w-14 rounded-lg border border-stone-200 object-cover"
            />
          )}
          {branding.name && (
            <p className="font-display text-lg font-bold text-slate-900">{branding.name}</p>
          )}
        </section>
      )}

      {/* Live now */}
      {live.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
            Live now
          </h2>
          <div className="flex flex-col gap-3">
            {live.map((m) => (
              <Link
                key={m.id}
                href={`/e/${eventSlug}/match/${m.id}`}
                className="block rounded-xl border border-emerald-300 bg-white p-4 transition-colors hover:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-red-500/40"
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs text-slate-500">{m.matchNumberLabel}</p>
                  {m.liceName && <p className="text-xs text-slate-500">{m.liceName}</p>}
                </div>
                <div className="flex items-center justify-between">
                  <p className="font-bold text-slate-900">{m.redFighterName ?? '?'}</p>
                  <p className="text-2xl font-black tabular-nums text-slate-900">
                    <span className={m.redScore > m.blueScore ? 'text-emerald-700' : undefined}>
                      {m.redScore}
                    </span>
                    <span className="mx-1.5 text-slate-400">–</span>
                    <span className={m.blueScore > m.redScore ? 'text-emerald-700' : undefined}>
                      {m.blueScore}
                    </span>
                  </p>
                  <p className="font-bold text-slate-900">{m.blueFighterName ?? '?'}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Upcoming favorites */}
      {upcoming.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Coming up
          </h2>
          <div className="flex flex-col gap-2">
            {upcoming.map((m) => (
              <Link
                key={m.id}
                href={`/e/${eventSlug}/match/${m.id}`}
                className="block rounded-xl border border-stone-200 bg-white px-4 py-3 transition-colors hover:border-stone-300 focus:outline-none focus:ring-2 focus:ring-red-500/40"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {m.redFighterName ?? '?'} vs {m.blueFighterName ?? '?'}
                    </p>
                    <p className="text-xs text-slate-500">{m.matchNumberLabel}</p>
                  </div>
                  {m.scheduledAt && (
                    <span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-mono text-slate-700">
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

      {/* Empty state */}
      {matches.length === 0 && (
        <div className="py-12 text-center">
          <p className="mb-3 text-4xl">👥</p>
          <p className="mb-4 text-slate-500">Follow fighters to see their matches here.</p>
          <Link
            href={`/e/${eventSlug}/people`}
            className="text-sm font-semibold text-red-700 underline hover:text-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
          >
            Browse participants →
          </Link>
        </div>
      )}
    </main>
  );
}
