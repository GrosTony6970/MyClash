/**
 * PublicHome — T-604
 * Persona: public (default)
 *
 * Shows: editorial/event intro, schedule highlights.
 */

import Link from 'next/link';
import { defaultLocale, t as tr } from '@myclash/i18n';
import { formatInZone } from '@myclash/time';
import { StatusBadge, formatCountryName, tournamentStatusSemantic } from '@myclash/ui';
import { EventBackLink } from './_components/EventBackLink';

interface EventInfo {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  startDate: string;
  endDate: string;
  publicLandingMd: string | null;
  status: string;
  timezone: string;
  logoUrl: string | null;
  heroImageUrl: string | null;
  organizationName: string | null;
  organizationLogoUrl: string | null;
}

function formatEventPlace(event: Pick<EventInfo, 'city' | 'country'>): string | null {
  const countryName = formatCountryName(event.country, defaultLocale);
  const parts = [event.city, countryName].filter((v): v is string => Boolean(v));
  return parts.length === 0 ? null : parts.join(', ');
}

interface Tournament {
  id: string;
  slug: string;
  name: string;
  status: string | null;
  color: string | null;
  ruleset_code: string | null;
  registered: number;
  waitlistCount: number;
  poolCount: number;
  bracketSize: number;
  refereeCount: number;
  poolFightsTotal: number;
  poolFightsCompleted: number;
  bracketFightsTotal: number;
  bracketFightsCompleted: number;
}

interface ParticipantRow {
  personId: string;
  tournaments: Array<{ registrationState: 'active' | 'waitlist' }>;
}

interface PublicWorkshop {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  level: string | null;
  durationMinutes: number | null;
  instructors: Array<{ displayName: string }>;
  sessions: Array<{ startsAt: string | null; endsAt: string | null }>;
}

async function fetchWorkshops(eventSlug: string, apiUrl: string): Promise<PublicWorkshop[]> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}/public-workshops`,
      { cache: 'no-store' },
    );
    if (!res.ok) return [];
    return (await res.json()) as PublicWorkshop[];
  } catch {
    return [];
  }
}

interface HighlightMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number;
  blueScore: number;
  liceName: string | null;
  tournamentName: string | null;
}

interface PublicVenue {
  id: string;
  name: string;
  address: string | null;
  hosts_tournament: boolean;
  hosts_workshop: boolean;
  venue_areas: Array<{ id: string; name: string }> | null;
}

async function fetchVenues(eventSlug: string, apiUrl: string): Promise<PublicVenue[]> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/events/slug/${encodeURIComponent(eventSlug)}/venues`,
      { cache: 'no-store' },
    );
    if (!res.ok) return [];
    return (await res.json()) as PublicVenue[];
  } catch {
    return [];
  }
}

interface Props {
  eventSlug: string;
  apiUrl: string;
}

async function fetchEventInfo(eventSlug: string, apiUrl: string): Promise<EventInfo | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    const org = raw['organizations'] as { name?: string; logo_url?: string } | null;
    // Supabase projects `themes(*)` either as a single object or as
    // an array depending on the joined cardinality; handle both.
    const themesRaw = raw['themes'] as
      | { hero_image_url?: string | null }
      | Array<{ hero_image_url?: string | null }>
      | null
      | undefined;
    const theme = Array.isArray(themesRaw) ? (themesRaw[0] ?? null) : (themesRaw ?? null);
    return {
      id: String(raw['id'] ?? ''),
      name: String(raw['name'] ?? ''),
      city: typeof raw['city'] === 'string' ? raw['city'] : null,
      country: typeof raw['country'] === 'string' ? raw['country'] : null,
      startDate: String(raw['start_date'] ?? raw['startDate'] ?? ''),
      endDate: String(raw['end_date'] ?? raw['endDate'] ?? ''),
      publicLandingMd:
        typeof (raw['public_landing_md'] ?? raw['publicLandingMd']) === 'string'
          ? String(raw['public_landing_md'] ?? raw['publicLandingMd'])
          : null,
      status: String(raw['status'] ?? ''),
      timezone: typeof raw['timezone'] === 'string' ? raw['timezone'] : 'Europe/Paris',
      logoUrl:
        typeof (raw['logo_url'] ?? raw['logoUrl']) === 'string'
          ? String(raw['logo_url'] ?? raw['logoUrl'])
          : null,
      heroImageUrl: typeof theme?.hero_image_url === 'string' ? theme.hero_image_url : null,
      organizationName: typeof org?.name === 'string' ? org.name : null,
      organizationLogoUrl: typeof org?.logo_url === 'string' ? org.logo_url : null,
    };
  } catch {
    return null;
  }
}

async function fetchTournaments(eventId: string, apiUrl: string): Promise<Tournament[]> {
  if (!eventId) return [];
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return (await res.json()) as Tournament[];
  } catch {
    return [];
  }
}

async function fetchParticipantsCounts(
  eventSlug: string,
  apiUrl: string,
): Promise<{ active: number; waitlist: number }> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}/participants`,
      { cache: 'no-store' },
    );
    if (!res.ok) return { active: 0, waitlist: 0 };
    const rows = (await res.json()) as ParticipantRow[];
    // Distinct people: a person counts as `active` if they have at
    // least one tournament with registrationState='active', else
    // `waitlist` if they only appear on waitlists. Avoids double-
    // counting people registered to multiple tournaments.
    let active = 0;
    let waitlist = 0;
    for (const row of rows) {
      const hasActive = row.tournaments.some((t) => t.registrationState === 'active');
      if (hasActive) active += 1;
      else waitlist += 1;
    }
    return { active, waitlist };
  } catch {
    return { active: 0, waitlist: 0 };
  }
}

async function fetchHighlights(eventSlug: string, apiUrl: string): Promise<HighlightMatch[]> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventSlug}/highlights`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return (await res.json()) as HighlightMatch[];
  } catch {
    return [];
  }
}

function colorTokenToHex(token: string | null | undefined): string {
  switch (token) {
    case 'red':
      return '#ef4444';
    case 'orange':
      return '#f97316';
    case 'amber':
      return '#f59e0b';
    case 'yellow':
      return '#eab308';
    case 'green':
      return '#22c55e';
    case 'teal':
      return '#14b8a6';
    case 'blue':
      return '#3b82f6';
    case 'violet':
      return '#8b5cf6';
    case 'purple':
      return '#a855f7';
    case 'pink':
      return '#ec4899';
    case 'gold':
      return '#facc15';
    case 'silver':
      return '#cbd5e1';
    case 'bronze':
      return '#d97706';
    default:
      return '#64748b';
  }
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  if (s.getFullYear() !== e.getFullYear()) {
    return `${s.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })} – ${e.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })}`;
  }
  if (s.getMonth() !== e.getMonth()) {
    return `${s.toLocaleDateString('fr-FR', opts)} – ${e.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })}`;
  }
  return `${s.getDate()}–${e.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })}`;
}

export async function PublicHome({ eventSlug, apiUrl }: Props) {
  const event = await fetchEventInfo(eventSlug, apiUrl);
  const [highlights, tournaments, participantsCounts, venues, workshops] = await Promise.all([
    fetchHighlights(eventSlug, apiUrl),
    fetchTournaments(event?.id ?? '', apiUrl),
    fetchParticipantsCounts(eventSlug, apiUrl),
    fetchVenues(eventSlug, apiUrl),
    fetchWorkshops(eventSlug, apiUrl),
  ]);

  const isCompleted = event?.status === 'completed';
  const live = highlights.filter((m) => m.status === 'running');
  const upcoming = highlights.filter((m) => m.status === 'scheduled').slice(0, 5);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 lg:max-w-6xl">
      <EventBackLink />

      {event?.heroImageUrl && (
        <section
          aria-label="Event hero"
          className="relative -mx-4 aspect-[16/7] max-h-[200px] overflow-hidden rounded-none sm:aspect-[9/2] sm:rounded-xl"
        >
          {/* Decorative banner — event name is in the H1 below, so
              alt="" is correct here. eslint-disable for plain <img>:
              the storage host isn't whitelisted in next.config.ts
              remotePatterns yet; promoting to next/image is a
              separate change. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={event.heroImageUrl} alt="" className="h-full w-full object-cover" />
        </section>
      )}

      {event && (
        <section className="flex flex-col gap-4 border-y border-stone-200 py-6 sm:flex-row sm:items-start sm:justify-between sm:py-8">
          <div className="flex items-start gap-3 min-w-0">
            {event.organizationLogoUrl && (
              /* Org logo — rounded square, kept on the left of the event name. */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={event.organizationLogoUrl}
                alt=""
                className="h-14 w-14 shrink-0 rounded-lg border border-stone-200 bg-white object-contain"
              />
            )}
            <div className="min-w-0 flex-1">
              <h1 className="mb-1 font-display text-3xl font-bold text-slate-900 sm:text-4xl">
                {event.name}
              </h1>
              {event.organizationName && (
                <p className="text-sm font-semibold text-slate-700">{event.organizationName}</p>
              )}
              {(() => {
                const place = formatEventPlace(event);
                return place ? <p className="text-sm text-slate-500">{place}</p> : null;
              })()}
              <p className="mt-0.5 text-sm text-slate-500">
                {formatDateRange(event.startDate, event.endDate)}
              </p>

              {event.status === 'running' && (
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/60 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
                  Live now
                </span>
              )}

              {event.publicLandingMd && (
                <div className="prose prose-sm mt-4 max-w-none text-sm leading-relaxed text-slate-700">
                  <p>{event.publicLandingMd}</p>
                </div>
              )}
            </div>
          </div>

          {event.logoUrl && (
            /* Event logo — moved to the right of the event name. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={event.logoUrl}
              alt=""
              className="h-20 w-20 shrink-0 rounded-xl border border-stone-200 bg-white object-cover sm:ml-4"
            />
          )}
        </section>
      )}

      {(participantsCounts.active > 0 || participantsCounts.waitlist > 0) && (
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">
            Participants
          </h2>
          <Link
            href={`/e/${eventSlug}/participants`}
            className="group block max-w-sm rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition-colors hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/40"
          >
            <p className="font-display text-xs font-bold uppercase tracking-widest text-slate-500">
              Participants
            </p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="text-4xl font-black tabular-nums text-slate-900">
                {participantsCounts.active}
              </span>
              <span className="text-sm text-slate-500">registered</span>
            </p>
            {participantsCounts.waitlist > 0 && (
              <p className="mt-1 flex items-baseline gap-2 border-t border-stone-200 pt-2">
                <span className="text-2xl font-bold tabular-nums text-amber-700">
                  {participantsCounts.waitlist}
                </span>
                <span className="text-sm text-slate-500">on waitlist</span>
              </p>
            )}
            <p className="mt-3 text-xs font-semibold text-red-700 group-hover:text-red-800">
              View list →
            </p>
          </Link>
        </section>
      )}

      {tournaments.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">
            Tournaments
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tournaments.map((t) => (
              <Link
                key={t.id}
                href={`/e/${eventSlug}/t/${encodeURIComponent(t.slug)}`}
                className="group relative flex min-h-36 flex-col justify-between overflow-hidden rounded-xl border border-stone-200 bg-white p-4 pl-5 shadow-sm transition-colors hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/40"
              >
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-0 h-full w-1"
                  style={{ backgroundColor: colorTokenToHex(t.color) }}
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-base font-semibold text-slate-900 truncate">
                      {t.name}
                    </p>
                    {t.ruleset_code && (
                      <p className="mt-0.5 font-mono text-xs text-slate-500">{t.ruleset_code}</p>
                    )}
                  </div>
                  {t.status && (
                    <StatusBadge semantic={tournamentStatusSemantic(t.status)} surface="light">
                      {t.status}
                    </StatusBadge>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div className="space-y-0.5">
                    {t.registered > 0 && (
                      <p className="text-slate-700">
                        <span className="font-semibold tabular-nums">{t.registered}</span>{' '}
                        <span className="text-slate-500">
                          {tr('publicApp.eventHome.card.fighters')}
                        </span>
                      </p>
                    )}
                    {t.refereeCount > 0 && (
                      <p className="text-slate-700">
                        <span className="font-semibold tabular-nums">{t.refereeCount}</span>{' '}
                        <span className="text-slate-500">
                          {tr('publicApp.eventHome.card.referees')}
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="space-y-0.5 text-right">
                    {t.poolCount > 0 && (
                      <p className="text-slate-700">
                        <span className="font-semibold tabular-nums">{t.poolCount}</span>{' '}
                        <span className="text-slate-500">
                          {tr('publicApp.eventHome.card.pools')}
                        </span>
                      </p>
                    )}
                    {t.bracketSize > 0 && (
                      <p className="text-slate-700">
                        <span className="text-slate-500">
                          {tr('publicApp.eventHome.card.bracket')}{' '}
                        </span>
                        <span className="font-semibold tabular-nums">{t.bracketSize}</span>
                      </p>
                    )}
                    {t.poolFightsTotal > 0 && (
                      <p className="text-slate-500">
                        {tr('publicApp.eventHome.card.completedPoolFights', {
                          completed: t.poolFightsCompleted,
                          total: t.poolFightsTotal,
                        })}
                      </p>
                    )}
                    {t.bracketFightsTotal > 0 && (
                      <p className="text-slate-500">
                        {tr('publicApp.eventHome.card.completedBracketFights', {
                          completed: t.bracketFightsCompleted,
                          total: t.bracketFightsTotal,
                        })}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex justify-end text-xs">
                  <span className="font-semibold text-red-700 group-hover:text-red-800">→</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {workshops.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">
            {tr('publicApp.eventHome.section.workshops')}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workshops.map((w) => {
              const session = w.sessions[0] ?? null;
              const instructorNames = w.instructors.map((i) => i.displayName);
              return (
                <Link
                  key={w.id}
                  href={`/e/${eventSlug}/w/${encodeURIComponent(w.slug)}`}
                  className="group flex min-h-32 flex-col justify-between overflow-hidden rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition-colors hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                >
                  <div className="min-w-0">
                    <p className="font-display text-base font-semibold text-slate-900">{w.title}</p>
                    {instructorNames.length > 0 && (
                      <p className="mt-0.5 truncate text-sm text-slate-500">
                        {instructorNames.join(', ')}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {w.category && (
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-slate-600">
                          {w.category}
                        </span>
                      )}
                      {w.level && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                          {w.level}
                        </span>
                      )}
                      {w.durationMinutes != null && (
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-slate-500">
                          {w.durationMinutes} min
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-slate-500">
                      {formatInZone(session?.startsAt ?? null, event?.timezone ?? 'Europe/Paris', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="font-semibold text-red-700 group-hover:text-red-800">→</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {venues.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">
            Venues
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {venues.map((v) => {
              const mapsHref = v.address
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address)}`
                : null;
              return (
                <article
                  key={v.id}
                  className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-display text-base font-semibold text-slate-900">
                        {v.name}
                      </p>
                      {v.address && <p className="mt-0.5 text-xs text-slate-500">{v.address}</p>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {v.hosts_tournament && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                          Tournament
                        </span>
                      )}
                      {v.hosts_workshop && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                          Workshop
                        </span>
                      )}
                    </div>
                  </div>
                  {v.venue_areas && v.venue_areas.length > 0 && (
                    <p className="text-xs text-slate-500">
                      {v.venue_areas.length} area{v.venue_areas.length === 1 ? '' : 's'}:{' '}
                      {v.venue_areas.map((a) => a.name).join(' · ')}
                    </p>
                  )}
                  {mapsHref && (
                    <a
                      href={mapsHref}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-xs font-semibold text-red-700 hover:text-red-800"
                    >
                      Open in Google Maps →
                    </a>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {!isCompleted && live.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-700">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
            Live now
          </h2>
          <div className="flex flex-col gap-3">
            {live.map((m) => (
              <Link
                key={m.id}
                href={`/e/${eventSlug}/match/${m.id}`}
                className="block rounded-xl border border-emerald-300 bg-white p-4 shadow-sm transition-colors hover:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                <p className="mb-2 text-xs text-slate-500">
                  {m.tournamentName} · {m.matchNumberLabel}
                  {m.liceName && ` · ${m.liceName}`}
                </p>
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

      {!isCompleted && upcoming.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">
            Schedule highlights
          </h2>
          <div className="flex flex-col gap-2">
            {upcoming.map((m) => (
              <Link
                key={m.id}
                href={`/e/${eventSlug}/match/${m.id}`}
                className="block rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm transition-colors hover:border-stone-300 focus:outline-none focus:ring-2 focus:ring-red-500/40"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {m.redFighterName ?? '?'} vs {m.blueFighterName ?? '?'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {m.tournamentName} · {m.matchNumberLabel}
                    </p>
                  </div>
                  {m.scheduledAt && (
                    <span className="rounded-md bg-stone-100 px-2 py-1 font-mono text-xs text-slate-700">
                      {formatInZone(m.scheduledAt, event?.timezone ?? 'Europe/Paris', {
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

      <section className="border-t border-stone-200 pt-6">
        {isCompleted ? (
          <>
            <p className="mb-3 text-sm text-slate-600">
              This event is over. Browse the per-tournament results below.
            </p>
            {tournaments[0] && (
              <Link
                href={`/e/${eventSlug}/t/${encodeURIComponent(tournaments[0].slug)}`}
                className="inline-block rounded-md bg-red-800 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40"
              >
                View results →
              </Link>
            )}
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-600">
              Are you a participant? Find yourself in the list to get a personalised view.
            </p>
            <Link
              href={`/e/${eventSlug}/onboarding`}
              className="inline-block rounded-md bg-red-800 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40"
            >
              I&apos;m a participant →
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
