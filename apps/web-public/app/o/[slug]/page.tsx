/**
 * Public organiser profile.
 * Route: /o/[slug]
 *
 * Shows who an organiser is and everything they run. Modelled on
 * /clubs/[slug], with richer metadata because this is a discovery surface
 * people link to.
 *
 * Two serial fetches rather than one fat endpoint: EventsService already
 * injects OrganizationsService, so having the organisation endpoint inline its
 * events would close a module cycle and need forwardRef. Reusing GET /events
 * also means the cards here get the same projection (tournament_count,
 * leagues[]) the landing page renders, for free.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { getServerApiUrl } from '@/lib/api-url';
import { getServerT, resolveServerLocale } from '@/i18n/server-locale';
import type { Locale } from '@myclash/i18n';
import { formatDateRange } from '../../_components/format-date-range';
import { partitionEvents } from '../../_components/filter-events';
import { FollowOrganizerButton } from './FollowOrganizerButton';

interface Props {
  params: Promise<{ slug: string }>;
}

interface PublicOrganizer {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
  followerCount: number;
}

interface OrganizerEvent {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  city?: string | null;
  country?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  tournament_count?: number | null;
  leagues?: Array<{ id: string; name: string; slug: string }> | null;
}

/** Past events are capped — the point is "they run events", not an archive. */
const PAST_LIMIT = 10;

async function fetchOrganizer(slug: string, apiUrl: string): Promise<PublicOrganizer | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/organizations/public/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicOrganizer;
  } catch {
    return null;
  }
}

async function fetchOrganizerEvents(orgId: string, apiUrl: string): Promise<OrganizerEvent[]> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/events?organizationId=${encodeURIComponent(orgId)}&limit=100`,
      { cache: 'no-store' },
    );
    if (!res.ok) return [];
    return (await res.json()) as OrganizerEvent[];
  } catch {
    // Soft-fail: an events outage should still leave the organiser findable.
    return [];
  }
}

// Operators publish from the admin app and expect the change to show here
// within seconds, same reasoning as the landing page.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const t = await getServerT();
  const org = await fetchOrganizer(slug, getServerApiUrl());
  if (!org) return { title: t('publicApp.organizer.notFoundTitle') };

  return {
    title: org.name,
    description: t('publicApp.organizer.metaDescription', { name: org.name }),
    openGraph: {
      title: org.name,
      description: t('publicApp.organizer.metaDescription', { name: org.name }),
      ...(org.logoUrl ? { images: [org.logoUrl] } : {}),
    },
  };
}

export default async function OrganizerPage({ params }: Props) {
  const t = await getServerT();
  const locale = await resolveServerLocale();
  const { slug } = await params;
  const apiUrl = getServerApiUrl();

  const org = await fetchOrganizer(slug, apiUrl);
  if (!org) {
    return (
      <main
        id="main-content"
        className="flex min-h-screen items-center justify-center px-4 text-center"
      >
        <div>
          <p className="mb-3 text-4xl">🛡️</p>
          <h1 className="mb-2 font-display text-2xl font-bold text-foreground sm:text-3xl">
            {t('publicApp.organizer.notFoundTitle')}
          </h1>
          <p className="text-sm text-muted">
            {t('publicApp.organizer.notFoundDescription', { slug })}
          </p>
        </div>
      </main>
    );
  }

  const events = await fetchOrganizerEvents(org.id, apiUrl);
  const { live, published, past } = partitionEvents(events);
  const upcoming = [...live, ...published];

  // Leagues have no organisation_id — they are platform-level. But GET /events
  // already projects the linked leagues per event, so "leagues this organiser
  // competes in" is a free dedupe over the payload we already have.
  const leagues = new Map<string, { id: string; name: string; slug: string }>();
  for (const event of events) {
    for (const league of event.leagues ?? []) leagues.set(league.id, league);
  }

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-8 flex items-center gap-4">
        {org.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={org.logoUrl}
            alt={org.name}
            className="h-16 w-16 rounded-xl border border-border bg-surface object-contain p-1"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-border bg-surface text-2xl">
            🛡️
          </div>
        )}
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
            {org.name}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t('publicApp.organizer.eventCount', { count: events.length })}
          </p>
          <div className="mt-2">
            <FollowOrganizerButton
              organizationId={org.id}
              slug={org.slug}
              followerCount={org.followerCount}
            />
          </div>
        </div>
        {/* Brand stripe — the organiser's own colour, same accent the landing
            page cards carry. Inline because it is per-row data, not a token. */}
        {org.brandColor && (
          <span
            aria-hidden="true"
            className="ml-auto hidden h-10 w-1.5 rounded-full sm:block"
            style={{ backgroundColor: org.brandColor }}
          />
        )}
      </header>

      {leagues.size > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('publicApp.organizer.sectionLeagues')}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {Array.from(leagues.values()).map((league) => (
              <li key={league.id}>
                <Link
                  href={`/leagues/${league.slug}`}
                  className="inline-flex rounded-full border border-border bg-surface px-3 py-1 text-sm font-medium text-foreground-secondary hover:bg-background"
                >
                  {league.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EventSection
        title={t('publicApp.organizer.sectionUpcoming')}
        events={upcoming}
        locale={locale}
        emptyLabel={t('publicApp.organizer.noUpcoming')}
      />

      {past.length > 0 && (
        <EventSection
          title={t('publicApp.organizer.sectionPast')}
          events={past.slice(0, PAST_LIMIT)}
          locale={locale}
          emptyLabel={null}
          footer={
            past.length > PAST_LIMIT
              ? t('publicApp.organizer.pastOverflow', { count: past.length - PAST_LIMIT })
              : null
          }
        />
      )}
    </main>
  );
}

function EventSection({
  title,
  events,
  locale,
  emptyLabel,
  footer = null,
}: {
  title: string;
  events: OrganizerEvent[];
  locale: Locale;
  emptyLabel: string | null;
  footer?: string | null;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 font-display text-lg font-semibold text-foreground sm:text-xl">
        {title}
      </h2>
      {events.length === 0 && emptyLabel ? (
        <p className="rounded-lg border border-dashed border-border bg-background p-6 text-center text-sm text-muted">
          {emptyLabel}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((event) => {
            const href = event.slug ? `/e/${event.slug}/home` : null;
            const place = [event.city, event.country].filter(Boolean).join(', ');
            const dates = formatDateRange(event, locale);
            const body = (
              <>
                <span className="block font-semibold text-foreground">{event.name}</span>
                <span className="mt-0.5 block text-sm text-muted">
                  {[dates, place].filter(Boolean).join(' · ')}
                </span>
              </>
            );
            return (
              <li key={event.id ?? event.slug}>
                {href ? (
                  <Link
                    href={href}
                    className="block rounded-lg border border-border bg-surface px-4 py-3 hover:bg-background"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="block rounded-lg border border-border bg-surface px-4 py-3">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {footer && <p className="mt-2 text-xs text-muted">{footer}</p>}
    </section>
  );
}
