/**
 * PublicHome — T-604
 * Persona: public (default)
 *
 * Shows: editorial/event intro, schedule highlights.
 */

import Link from 'next/link';
import { t as tr } from '@myclash/i18n';
import { formatInZone, zonedDay } from '@myclash/time';
import { StatusBadge, accentClassFor, tournamentStatusSemantic } from '@myclash/ui';
import { EventBackLink } from './_components/EventBackLink';
import { EventHeader, fetchEventInfo } from '../_components/EventHeader';

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
  /** Earliest / latest scheduled match (ISO) — drives the Schedule agenda. */
  scheduledStart: string | null;
  scheduledEnd: string | null;
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
  color: string | null;
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

  // Schedule agenda: every scheduled tournament + workshop as one chronological,
  // day-grouped list of cards (the tournament window comes from its match
  // scheduled_at span; the workshop from its earliest session).
  const tz = event?.timezone ?? 'Europe/Paris';
  type ScheduleEntry = {
    id: string;
    startsAt: string;
    endsAt: string | null;
    title: string;
    subtitle: string | null;
    kindLabel: string;
    color: string | null;
    href: string;
  };
  const scheduleEntries: ScheduleEntry[] = [
    ...tournaments
      .filter((tournament) => tournament.scheduledStart)
      .map((tournament) => ({
        id: `t-${tournament.id}`,
        startsAt: tournament.scheduledStart as string,
        endsAt: tournament.scheduledEnd,
        title: tournament.name,
        subtitle: tournament.ruleset_code,
        kindLabel: tr('publicApp.eventHome.schedule.tournament'),
        color: tournament.color,
        href: `/e/${eventSlug}/t/${encodeURIComponent(tournament.slug)}`,
      })),
    ...workshops
      .map((w) => {
        const session = w.sessions
          .filter((s) => s.startsAt)
          .sort((a, b) => ((a.startsAt as string) < (b.startsAt as string) ? -1 : 1))[0];
        return session ? { w, session } : null;
      })
      .filter((x): x is { w: PublicWorkshop; session: PublicWorkshop['sessions'][number] } =>
        Boolean(x),
      )
      .map(({ w, session }) => ({
        id: `w-${w.id}`,
        startsAt: session.startsAt as string,
        endsAt: session.endsAt,
        title: w.title,
        subtitle: w.instructors.map((i) => i.displayName).join(', ') || null,
        kindLabel: tr('publicApp.eventHome.schedule.workshop'),
        color: w.color,
        href: `/e/${eventSlug}/w/${encodeURIComponent(w.slug)}`,
      })),
  ].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  const scheduleByDay = new Map<string, ScheduleEntry[]>();
  for (const entry of scheduleEntries) {
    const key = zonedDay(entry.startsAt, tz) ?? entry.startsAt.slice(0, 10);
    const arr = scheduleByDay.get(key) ?? [];
    arr.push(entry);
    scheduleByDay.set(key, arr);
  }
  const scheduleDays = [...scheduleByDay.keys()].sort();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 lg:max-w-6xl">
      <EventBackLink />

      {event && <EventHeader event={event} />}

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

      {scheduleEntries.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">
            {tr('publicApp.eventHome.section.schedule')}
          </h2>
          <div className="flex flex-col gap-4">
            {scheduleDays.map((dayKey) => {
              const items = scheduleByDay.get(dayKey) ?? [];
              const rep = items[0]?.startsAt ?? null;
              return (
                <div key={dayKey}>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {rep
                      ? formatInZone(rep, tz, { weekday: 'long', day: 'numeric', month: 'long' })
                      : dayKey}
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((entry) => (
                      <Link
                        key={entry.id}
                        href={entry.href}
                        className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-stone-200 bg-white p-3 pl-4 shadow-sm transition-colors hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                      >
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-0 h-full w-1"
                          style={{ backgroundColor: colorTokenToHex(entry.color) }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-xs font-semibold text-slate-700">
                            {formatInZone(entry.startsAt, tz, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                            {entry.endsAt &&
                              `–${formatInZone(entry.endsAt, tz, {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}`}
                          </p>
                          <p className="truncate font-display text-sm font-semibold text-slate-900">
                            {entry.title}
                          </p>
                          {entry.subtitle && (
                            <p className="truncate text-xs text-slate-500">{entry.subtitle}</p>
                          )}
                        </div>
                        <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                          {entry.kindLabel}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
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
                  </div>
                </div>
                {(t.poolFightsTotal > 0 || t.bracketFightsTotal > 0) && (
                  <div className="mt-1 space-y-0.5 text-right text-xs text-slate-500">
                    {t.poolFightsTotal > 0 && (
                      <p className="whitespace-nowrap">
                        {tr('publicApp.eventHome.card.completedPoolFights', {
                          completed: t.poolFightsCompleted,
                          total: t.poolFightsTotal,
                        })}
                      </p>
                    )}
                    {t.bracketFightsTotal > 0 && (
                      <p className="whitespace-nowrap">
                        {tr('publicApp.eventHome.card.completedBracketFights', {
                          completed: t.bracketFightsCompleted,
                          total: t.bracketFightsTotal,
                        })}
                      </p>
                    )}
                  </div>
                )}
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
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">
              {tr('publicApp.eventHome.section.workshops')}
            </h2>
            <Link
              href={`/e/${eventSlug}/workshops`}
              className="text-xs font-semibold text-red-700 hover:text-red-800"
            >
              {tr('publicApp.eventHome.workshops.seeFullList')}
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workshops.slice(0, 6).map((w) => {
              const session = w.sessions[0] ?? null;
              const instructorNames = w.instructors.map((i) => i.displayName);
              return (
                <Link
                  key={w.id}
                  href={`/e/${eventSlug}/w/${encodeURIComponent(w.slug)}`}
                  className="group relative flex min-h-32 flex-col justify-between overflow-hidden rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition-colors hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                >
                  {w.color && (
                    <span
                      aria-hidden="true"
                      className={`absolute inset-y-0 left-0 w-1 ${accentClassFor(w.color)}`}
                    />
                  )}
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
