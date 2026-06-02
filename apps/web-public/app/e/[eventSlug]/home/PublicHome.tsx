/**
 * PublicHome — T-604
 * Persona: public (default)
 *
 * Shows: editorial/event intro, schedule highlights.
 */

import Link from 'next/link';
import { EventBackLink } from './_components/EventBackLink';

interface EventInfo {
  id: string;
  name: string;
  location: string | null;
  startDate: string;
  endDate: string;
  publicLandingMd: string | null;
  status: string;
  logoUrl: string | null;
  heroImageUrl: string | null;
  organizationName: string | null;
  organizationLogoUrl: string | null;
}

interface Tournament {
  id: string;
  slug: string;
  name: string;
  status: string | null;
  color: string | null;
  ruleset_code: string | null;
}

interface ParticipantRow {
  personId: string;
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
      location: typeof raw['location'] === 'string' ? raw['location'] : null,
      startDate: String(raw['start_date'] ?? raw['startDate'] ?? ''),
      endDate: String(raw['end_date'] ?? raw['endDate'] ?? ''),
      publicLandingMd:
        typeof (raw['public_landing_md'] ?? raw['publicLandingMd']) === 'string'
          ? String(raw['public_landing_md'] ?? raw['publicLandingMd'])
          : null,
      status: String(raw['status'] ?? ''),
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

async function fetchParticipantsCount(eventSlug: string, apiUrl: string): Promise<number> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}/participants`,
      { cache: 'no-store' },
    );
    if (!res.ok) return 0;
    const rows = (await res.json()) as ParticipantRow[];
    return rows.length;
  } catch {
    return 0;
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
  const [highlights, tournaments, participantsCount] = await Promise.all([
    fetchHighlights(eventSlug, apiUrl),
    fetchTournaments(event?.id ?? '', apiUrl),
    fetchParticipantsCount(eventSlug, apiUrl),
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
          className="relative -mx-4 aspect-[24/10] overflow-hidden rounded-none sm:aspect-[3/1] sm:rounded-xl"
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
        <section className="flex flex-col gap-4 border-y border-stone-200 py-6 sm:flex-row sm:items-start sm:py-8">
          {(event.logoUrl || event.organizationLogoUrl) && (
            <div className="flex items-center gap-2">
              {event.logoUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={event.logoUrl}
                  alt=""
                  className="h-20 w-20 rounded-xl border border-stone-200 bg-white object-cover"
                />
              )}
              {event.organizationLogoUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={event.organizationLogoUrl}
                  alt=""
                  className="h-12 w-12 rounded-full border border-stone-200 bg-white object-contain"
                />
              )}
            </div>
          )}
          <div className="flex-1">
            <h1 className="mb-1 font-display text-3xl font-bold text-slate-900 sm:text-4xl">
              {event.name}
            </h1>
            {event.organizationName && (
              <p className="text-sm font-semibold text-slate-700">{event.organizationName}</p>
            )}
            {event.location && <p className="text-sm text-slate-500">{event.location}</p>}
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
        </section>
      )}

      {participantsCount > 0 && (
        <section>
          <Link
            href={`/e/${eventSlug}/participants`}
            className="inline-flex items-center gap-2 rounded-full border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500/40"
          >
            <span>👥</span>
            <span>View {participantsCount} participants</span>
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
                className="group relative flex min-h-32 flex-col justify-between overflow-hidden rounded-xl border border-stone-200 bg-white p-4 pl-5 shadow-sm transition-colors hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/40"
              >
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-0 h-full w-1"
                  style={{ backgroundColor: colorTokenToHex(t.color) }}
                />
                <div>
                  <p className="font-display text-base font-semibold text-slate-900">{t.name}</p>
                  {t.ruleset_code && (
                    <p className="mt-0.5 font-mono text-xs text-slate-500">{t.ruleset_code}</p>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Pools · Bracket · Podium</span>
                  <span className="font-semibold text-red-700 group-hover:text-red-800">→</span>
                </div>
              </Link>
            ))}
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
