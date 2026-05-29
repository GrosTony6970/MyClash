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
    // Backend returns snake_case (logo_url) from the events table. Coerce
    // to the camelCase shape this component reads.
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

/** Map the tournaments.color token (admin app sets this) onto a CSS hex
 *  so the stripe on each tournament card carries the operator's chosen
 *  colour. Falls back to neutral gray for unknown tokens. */
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
      {/* Slice A: in-page back link. The shared SiteHeader has the
          logo as a link to `/`, but operators on phones want an
          explicit affordance. Sits above everything. */}
      <EventBackLink />

      {/* Event intro */}
      {event && (
        <section className="flex flex-col gap-4 border-y border-neutral-800 py-6 sm:flex-row sm:items-start sm:py-8">
          {(event.logoUrl || event.organizationLogoUrl) && (
            <div className="flex items-center gap-2">
              {event.logoUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={event.logoUrl}
                  alt=""
                  className="h-20 w-20 rounded-xl border border-neutral-800 object-cover"
                />
              )}
              {event.organizationLogoUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={event.organizationLogoUrl}
                  alt=""
                  className="h-12 w-12 rounded-full border border-neutral-800 object-contain"
                />
              )}
            </div>
          )}
          <div className="flex-1">
            <h1 className="mb-1 font-display text-3xl font-bold text-neutral-100 sm:text-4xl">
              {event.name}
            </h1>
            {event.organizationName && (
              <p className="text-sm text-neutral-400">{event.organizationName}</p>
            )}
            {event.location && <p className="text-sm text-neutral-500">{event.location}</p>}
            <p className="mt-0.5 text-sm text-neutral-500">
              {formatDateRange(event.startDate, event.endDate)}
            </p>

            {/* Status badge */}
            {event.status === 'running' && (
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" />
                Live now
              </span>
            )}

            {/* Editorial / landing markdown */}
            {event.publicLandingMd && (
              <div className="prose prose-invert prose-sm mt-4 max-w-none text-sm leading-relaxed text-neutral-300">
                {/* Render as plain text — full markdown rendering is T-606+ */}
                <p>{event.publicLandingMd}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Slice 2: participants summary chip — links to the new participants page. */}
      {participantsCount > 0 && (
        <section>
          <Link
            href={`/e/${eventSlug}/participants`}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          >
            <span>👥</span>
            <span>View {participantsCount} participants</span>
          </Link>
        </section>
      )}

      {/* Slice 2: tournaments grid — one card per tournament with colour stripe. */}
      {tournaments.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-neutral-400">
            Tournaments
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tournaments.map((t) => (
              <Link
                key={t.id}
                href={`/e/${eventSlug}/t/${encodeURIComponent(t.slug)}`}
                className="group relative flex min-h-32 flex-col justify-between overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 p-4 pl-5 transition-colors hover:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                {/* Per-tournament accent stripe — organiser-set colour
                    moves to a thin left edge so the card body stays
                    neutral. */}
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-0 h-full w-1"
                  style={{ backgroundColor: colorTokenToHex(t.color) }}
                />
                <div>
                  <p className="text-base font-bold text-neutral-100">{t.name}</p>
                  {t.ruleset_code && (
                    <p className="mt-0.5 text-xs text-neutral-500">{t.ruleset_code}</p>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-400">Pools · Bracket · Podium</span>
                  <span className="font-semibold text-emerald-400 group-hover:text-emerald-300">
                    →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Live matches — hidden for completed events. */}
      {!isCompleted && live.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-300">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 motion-safe:animate-pulse" />
            Live now
          </h2>
          <div className="flex flex-col gap-3">
            {live.map((m) => (
              <Link
                key={m.id}
                href={`/e/${eventSlug}/match/${m.id}`}
                className="block rounded-xl border border-emerald-500/30 bg-neutral-900 p-4 transition-colors hover:border-emerald-400/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                <p className="mb-2 text-xs text-neutral-400">
                  {m.tournamentName} · {m.matchNumberLabel}
                  {m.liceName && ` · ${m.liceName}`}
                </p>
                <div className="flex items-center justify-between">
                  <p className="font-bold text-neutral-100">{m.redFighterName ?? '?'}</p>
                  <p className="text-2xl font-black tabular-nums text-neutral-100">
                    <span className={m.redScore > m.blueScore ? 'text-emerald-400' : undefined}>
                      {m.redScore}
                    </span>
                    <span className="mx-1.5 text-neutral-600">–</span>
                    <span className={m.blueScore > m.redScore ? 'text-emerald-400' : undefined}>
                      {m.blueScore}
                    </span>
                  </p>
                  <p className="font-bold text-neutral-100">{m.blueFighterName ?? '?'}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Schedule highlights — also hidden for completed events. */}
      {!isCompleted && upcoming.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-neutral-400">
            Schedule highlights
          </h2>
          <div className="flex flex-col gap-2">
            {upcoming.map((m) => (
              <Link
                key={m.id}
                href={`/e/${eventSlug}/match/${m.id}`}
                className="block rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 transition-colors hover:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-neutral-100">
                      {m.redFighterName ?? '?'} vs {m.blueFighterName ?? '?'}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {m.tournamentName} · {m.matchNumberLabel}
                    </p>
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

      {/* CTA: onboarding for upcoming/running events, results for completed. */}
      <section className="border-t border-neutral-800 pt-6">
        {isCompleted ? (
          <>
            <p className="mb-3 text-sm text-neutral-400">
              This event is over. Browse the per-tournament results below.
            </p>
            {tournaments[0] && (
              <Link
                href={`/e/${eventSlug}/t/${encodeURIComponent(tournaments[0].slug)}`}
                className="inline-block rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                View results →
              </Link>
            )}
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-neutral-400">
              Are you a participant? Find yourself in the list to get a personalised view.
            </p>
            <Link
              href={`/e/${eventSlug}/onboarding`}
              className="inline-block rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            >
              I&apos;m a participant →
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
