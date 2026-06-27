/* eslint-disable myclash/no-literal-string -- pre-i18n public page; section labels/CTA are English-for-now (matches the workshops + workshop-detail public pages). */

/**
 * PublicHome — T-604
 * Persona: public (default)
 *
 * Sections: Participants, Tournaments (3 + see all), Workshops (6 + see all),
 * Schedule (two summary cards → per-kind schedule pages), Venues, Live,
 * Highlights, CTA. Card lists scroll horizontally on phones.
 */

import Link from 'next/link';
import { t as tr } from '@myclash/i18n';
import { formatInZone } from '@myclash/time';
import { BackLink } from '@/components/BackLink';
import { EventBackLink } from './_components/EventBackLink';
import { EventHeader, fetchEventInfo } from '../_components/EventHeader';
import { TournamentCard } from './_components/TournamentCard';
import { WorkshopCard } from './_components/WorkshopCard';
import {
  fetchHighlights,
  fetchParticipantsCounts,
  fetchTournaments,
  fetchVenues,
  fetchWorkshops,
} from './_lib/public-event-data';

interface Props {
  eventSlug: string;
  apiUrl: string;
  /** Rendered inside the personal-space shell (/me/events/[slug]) — keep the
   *  back-link pointing into /me instead of the public events landing. */
  personalShell?: boolean;
}

// Horizontal snap-scroller on phones; the existing grid from `sm` up.
const CARD_SCROLL =
  'flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 sm:gap-3 sm:overflow-visible sm:pb-0 lg:grid-cols-3';
const CARD_SCROLL_2 =
  'flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 sm:gap-3 sm:overflow-visible sm:pb-0';
const SCROLL_ITEM = 'min-w-[80%] shrink-0 snap-start sm:min-w-0';

export async function PublicHome({ eventSlug, apiUrl, personalShell = false }: Props) {
  const event = await fetchEventInfo(eventSlug, apiUrl);
  const [highlights, tournaments, participantsCounts, venues, workshops] = await Promise.all([
    fetchHighlights(eventSlug, apiUrl),
    fetchTournaments(event?.id ?? '', apiUrl),
    fetchParticipantsCounts(eventSlug, apiUrl),
    fetchVenues(eventSlug, apiUrl),
    fetchWorkshops(eventSlug, apiUrl),
  ]);

  const tz = event?.timezone ?? 'Europe/Paris';
  const isCompleted = event?.status === 'completed';
  const live = highlights.filter((m) => m.status === 'running');
  const upcoming = highlights.filter((m) => m.status === 'scheduled').slice(0, 5);

  // Schedule summary times: tournament side = first pool (earliest scheduled
  // match across tournaments); workshop side = the session window (earliest
  // start → latest end).
  const firstPoolStart =
    tournaments
      .map((t) => t.scheduledStart)
      .filter((s): s is string => Boolean(s))
      .sort()[0] ?? null;
  const wsSessions = workshops.flatMap((w) => w.sessions);
  const wsStarts = wsSessions
    .map((s) => s.startsAt)
    .filter((s): s is string => Boolean(s))
    .sort();
  const wsEnds = wsSessions
    .map((s) => s.endsAt)
    .filter((s): s is string => Boolean(s))
    .sort();
  const wsFirstStart = wsStarts[0] ?? null;
  const wsLastEnd = wsEnds.length > 0 ? wsEnds[wsEnds.length - 1] : null;
  const dateTimeFmt = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  } as const;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 lg:max-w-6xl">
      {personalShell ? (
        <BackLink href="/me/events" label={tr('publicApp.eventHome.backToEvents')} />
      ) : (
        <EventBackLink />
      )}

      {event && <EventHeader event={event} />}

      {(participantsCounts.active > 0 || participantsCounts.waitlist > 0) && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
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
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Tournaments
            </h2>
            {tournaments.length > 3 && (
              <Link
                href={`/e/${eventSlug}/tournaments`}
                className="text-xs font-semibold text-red-700 hover:text-red-800"
              >
                {tr('publicApp.eventHome.tournaments.seeFullList')}
              </Link>
            )}
          </div>
          <div className={CARD_SCROLL}>
            {tournaments.slice(0, 3).map((t) => (
              <TournamentCard
                key={t.id}
                tournament={t}
                eventSlug={eventSlug}
                tz={tz}
                className={SCROLL_ITEM}
              />
            ))}
          </div>
        </section>
      )}

      {workshops.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {tr('publicApp.eventHome.section.workshops')}
            </h2>
            {workshops.length > 6 && (
              <Link
                href={`/e/${eventSlug}/workshops`}
                className="text-xs font-semibold text-red-700 hover:text-red-800"
              >
                {tr('publicApp.eventHome.workshops.seeFullList')}
              </Link>
            )}
          </div>
          <div className={CARD_SCROLL}>
            {workshops.slice(0, 6).map((w) => (
              <WorkshopCard
                key={w.id}
                workshop={w}
                eventSlug={eventSlug}
                tz={tz}
                className={SCROLL_ITEM}
              />
            ))}
          </div>
        </section>
      )}

      {(tournaments.length > 0 || workshops.length > 0) && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            {tr('publicApp.eventHome.section.schedule')}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {tournaments.length > 0 && (
              <Link
                href={`/e/${eventSlug}/schedule/tournaments`}
                className="group relative flex items-center justify-between gap-3 overflow-hidden rounded-xl border border-stone-200 bg-white p-4 pl-5 shadow-sm transition-colors hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/40"
              >
                <span aria-hidden="true" className="absolute left-0 top-0 h-full w-1 bg-red-500" />
                <div className="min-w-0">
                  <p className="font-display text-base font-semibold text-slate-900">
                    {tr('publicApp.eventHome.schedule.tournamentsCard')}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {firstPoolStart
                      ? `${tr('publicApp.eventHome.tournament.firstPool')}: ${formatInZone(firstPoolStart, tz, dateTimeFmt)}`
                      : tr('publicApp.eventHome.schedule.notScheduled')}
                  </p>
                </div>
                <span className="shrink-0 font-semibold text-red-700 group-hover:text-red-800">
                  →
                </span>
              </Link>
            )}
            {workshops.length > 0 && (
              <Link
                href={`/e/${eventSlug}/schedule/workshops`}
                className="group relative flex items-center justify-between gap-3 overflow-hidden rounded-xl border border-stone-200 bg-white p-4 pl-5 shadow-sm transition-colors hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/40"
              >
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-0 h-full w-1 bg-amber-500"
                />
                <div className="min-w-0">
                  <p className="font-display text-base font-semibold text-slate-900">
                    {tr('publicApp.eventHome.schedule.workshopsCard')}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {wsFirstStart
                      ? `${formatInZone(wsFirstStart, tz, dateTimeFmt)}${wsLastEnd ? ` → ${formatInZone(wsLastEnd, tz, dateTimeFmt)}` : ''}`
                      : tr('publicApp.eventHome.schedule.notScheduled')}
                  </p>
                </div>
                <span className="shrink-0 font-semibold text-red-700 group-hover:text-red-800">
                  →
                </span>
              </Link>
            )}
          </div>
        </section>
      )}

      {venues.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Venues
          </h2>
          <div className={CARD_SCROLL_2}>
            {venues.map((v) => {
              const mapsHref = v.address
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address)}`
                : null;
              return (
                <article
                  key={v.id}
                  className={`flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-4 shadow-sm ${SCROLL_ITEM}`}
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
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">
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
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
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
                      {formatInZone(m.scheduledAt, tz, {
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
