/**
 * CompetitorHome — T-604
 * Persona: competitor / referee
 *
 * Shows: my next match, today's parcours (schedule), my last results.
 */

import Link from 'next/link';
import { createTranslator, getMessages } from '@myclash/i18n';
import { localeToBcp47 } from '@myclash/time';
import { EventBackLink } from './_components/EventBackLink';
import { getServerApiUrl } from '@/lib/api-url';
import { resolveServerLocale } from '@/i18n/server-locale';

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

export async function CompetitorHome({ eventSlug }: Props) {
  const apiUrl = getServerApiUrl();
  const locale = await resolveServerLocale();
  const tag = localeToBcp47(locale);
  const t = createTranslator(getMessages(locale));
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
              className="h-14 w-14 rounded-lg border border-border object-cover"
            />
          )}
          {branding.name && (
            <p className="font-display text-lg font-bold text-foreground">{branding.name}</p>
          )}
        </section>
      )}

      {/* Next match */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('publicApp.competitorHome.nextMatch')}
        </h2>
        {nextMatch ? (
          <Link
            href={`/e/${eventSlug}/match/${nextMatch.id}`}
            className="block rounded-xl border border-success/40 bg-surface p-5 transition-colors hover:border-success focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            <p className="mb-1 text-xs text-muted">{nextMatch.matchNumberLabel}</p>
            <p className="text-xl font-bold text-foreground">
              {t('publicApp.competitorHome.versus', {
                name: nextMatch.opponentName ?? t('publicApp.competitorHome.tbd'),
              })}
            </p>
            {nextMatch.scheduledAt && (
              <p className="mt-1 text-sm text-muted">
                {new Date(nextMatch.scheduledAt).toLocaleTimeString(tag, {
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
                  ? 'border border-success/60 bg-success/10 text-success'
                  : 'border border-border bg-background text-foreground-secondary',
              ].join(' ')}
            >
              {nextMatch.status === 'running' && (
                <span className="h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
              )}
              {nextMatch.status === 'running'
                ? t('publicApp.competitorHome.live')
                : nextMatch.status}
            </span>
          </Link>
        ) : (
          <div className="rounded-xl border border-border bg-surface p-5 text-center">
            <p className="text-sm text-muted">{t('publicApp.competitorHome.noUpcomingMatches')}</p>
          </div>
        )}
      </section>

      {/* Today's parcours */}
      {upcoming.length > 1 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('publicApp.competitorHome.todaysSchedule')}
          </h2>
          <div className="flex flex-col gap-2">
            {upcoming.slice(1).map((m) => (
              <Link
                key={m.id}
                href={`/e/${eventSlug}/match/${m.id}`}
                className="block rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t('publicApp.competitorHome.versus', {
                        name: m.opponentName ?? t('publicApp.competitorHome.tbd'),
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

      {/* Last results */}
      {past.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('publicApp.fighterProfile.recentResults')}
          </h2>
          <div className="flex flex-col gap-2">
            {past.map((m) => (
              <Link
                key={m.id}
                href={`/e/${eventSlug}/match/${m.id}`}
                className="block rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t('publicApp.competitorHome.versus', {
                        name: m.opponentName ?? t('publicApp.competitorHome.tbd'),
                      })}
                    </p>
                    <p className="text-xs text-muted">{m.matchNumberLabel}</p>
                  </div>
                  {/* Highlights the higher score, which is NOT the winner when
                      a forfeit or a `referee_decision` override decided the
                      bout. Left as-is deliberately: `/my-matches` is a KNOWN
                      PHANTOM route (frontend-route-contract.test.ts), so `past`
                      is always empty and there is no shape to read a winner
                      from. Whoever builds that endpoint must ship `outcome`
                      like the person schedule does, and use it here. */}
                  <p className="text-lg font-black tabular-nums text-foreground">
                    <span className={m.redScore > m.blueScore ? 'text-success' : undefined}>
                      {m.redScore}
                    </span>
                    <span className="mx-1 text-muted">–</span>
                    <span className={m.blueScore > m.redScore ? 'text-success' : undefined}>
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
          <p className="text-muted">{t('publicApp.competitorHome.emptyMatches')}</p>
        </div>
      )}
    </main>
  );
}
