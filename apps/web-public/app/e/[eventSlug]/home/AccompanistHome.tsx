/**
 * AccompanistHome — T-604
 * Persona: accompanist
 *
 * Shows: favorites live, big matches.
 */

import Link from 'next/link';
import { createTranslator, getMessages } from '@myclash/i18n';
import { localeToBcp47 } from '@myclash/time';
import { EventBackLink } from './_components/EventBackLink';
import { LiveMatchCard } from './_components/LiveMatchCard';
import { getServerApiUrl } from '@/lib/api-url';
import { resolveServerLocale } from '@/i18n/server-locale';

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

export async function AccompanistHome({ eventSlug }: Props) {
  const apiUrl = getServerApiUrl();
  const locale = await resolveServerLocale();
  const tag = localeToBcp47(locale);
  const t = createTranslator(getMessages(locale));
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
              className="h-14 w-14 rounded-lg border border-border object-cover"
            />
          )}
          {branding.name && (
            <p className="font-display text-lg font-bold text-foreground">{branding.name}</p>
          )}
        </section>
      )}

      {/* Live now */}
      {live.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-success">
            <span className="inline-block h-2 w-2 rounded-full bg-success motion-safe:animate-pulse" />
            {t('publicApp.eventHome.liveNow')}
          </h2>
          <div className="flex flex-col gap-3">
            {live.map((m) => (
              <LiveMatchCard key={m.id} match={m} href={`/e/${eventSlug}/match/${m.id}`} />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming favorites */}
      {upcoming.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('publicApp.accompanistHome.comingUp')}
          </h2>
          <div className="flex flex-col gap-2">
            {upcoming.map((m) => (
              <Link
                key={m.id}
                href={`/e/${eventSlug}/match/${m.id}`}
                className="block rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t('publicApp.accompanistHome.fighterVersus', {
                        red: m.redFighterName ?? '?',
                        blue: m.blueFighterName ?? '?',
                      })}
                    </p>
                    <p className="text-xs text-muted">{m.matchNumberLabel}</p>
                  </div>
                  {m.scheduledAt && (
                    <span className="rounded-md bg-border px-2 py-1 text-xs font-mono text-foreground-secondary">
                      {new Date(m.scheduledAt).toLocaleTimeString(tag, {
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
          <p className="mb-4 text-muted">{t('publicApp.accompanistHome.emptyFollowing')}</p>
          <Link
            href={`/e/${eventSlug}/people`}
            className="text-sm font-semibold text-accent underline hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {t('publicApp.accompanistHome.browseParticipants')}
          </Link>
        </div>
      )}
    </main>
  );
}
