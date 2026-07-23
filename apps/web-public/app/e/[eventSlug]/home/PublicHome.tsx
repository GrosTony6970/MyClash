/**
 * PublicHome — T-604
 * Persona: public (default)
 *
 * Sections: Participants, Tournaments (3 + see all), Workshops (6 + see all),
 * Schedule (two summary cards → per-kind schedule pages), Venues, Live,
 * Highlights, CTA. Card lists scroll horizontally on phones.
 */

import Link from 'next/link';
import { createTranslator, getMessages } from '@myclash/i18n';
import { formatInZone, localeToBcp47 } from '@myclash/time';
import { BackLink } from '@/components/BackLink';
import { getServerApiUrl } from '@/lib/api-url';
import { resolveServerLocale } from '@/i18n/server-locale';
import { EventBackLink } from './_components/EventBackLink';
import { EventHeader, fetchEventInfo } from '../_components/EventHeader';
import { TournamentCard } from './_components/TournamentCard';
import { WorkshopCard } from './_components/WorkshopCard';
import { LiveNowSection } from './_components/LiveNowSection';
import {
  fetchHighlights,
  fetchParticipantsCounts,
  fetchTournaments,
  fetchVenues,
  fetchWorkshops,
} from './_lib/public-event-data';

interface Props {
  eventSlug: string;
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

export async function PublicHome({ eventSlug, personalShell = false }: Props) {
  const apiUrl = getServerApiUrl();
  const locale = await resolveServerLocale();
  const tr = createTranslator(getMessages(locale));
  const tag = localeToBcp47(locale);
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

      {event && <EventHeader event={event} locale={locale} eventSlug={eventSlug} />}

      {(participantsCounts.active > 0 || participantsCounts.waitlist > 0) && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {tr('publicApp.people.title')}
          </h2>
          <Link
            href={`/e/${eventSlug}/participants`}
            className="group block max-w-sm rounded-xl border border-border bg-surface p-5 shadow-sm transition-colors hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            <p className="font-display text-xs font-bold uppercase tracking-widest text-muted">
              {tr('publicApp.people.title')}
            </p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="text-4xl font-black tabular-nums text-foreground">
                {participantsCounts.active}
              </span>
              <span className="text-sm text-muted">
                {tr('publicApp.eventHome.participants.registered')}
              </span>
            </p>
            {participantsCounts.waitlist > 0 && (
              <p className="mt-1 flex items-baseline gap-2 border-t border-border pt-2">
                <span className="text-2xl font-bold tabular-nums text-warning">
                  {participantsCounts.waitlist}
                </span>
                <span className="text-sm text-muted">
                  {tr('publicApp.eventHome.participants.onWaitlist')}
                </span>
              </p>
            )}
            <p className="mt-3 text-xs font-semibold text-accent group-hover:text-accent-hover">
              {tr('publicApp.eventHome.participants.viewList')}
            </p>
          </Link>
        </section>
      )}

      {tournaments.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              {tr('publicApp.eventHome.section.tournaments')}
            </h2>
            {tournaments.length > 3 && (
              <Link
                href={`/e/${eventSlug}/tournaments`}
                className="text-xs font-semibold text-accent hover:text-accent-hover"
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
                locale={locale}
                className={SCROLL_ITEM}
              />
            ))}
          </div>
        </section>
      )}

      {workshops.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              {tr('publicApp.eventHome.section.workshops')}
            </h2>
            {workshops.length > 6 && (
              <Link
                href={`/e/${eventSlug}/workshops`}
                className="text-xs font-semibold text-accent hover:text-accent-hover"
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
                locale={locale}
                className={SCROLL_ITEM}
              />
            ))}
          </div>
        </section>
      )}

      {(tournaments.length > 0 || workshops.length > 0) && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {tr('publicApp.eventHome.section.schedule')}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {tournaments.length > 0 && (
              <Link
                href={`/e/${eventSlug}/schedule/tournaments`}
                className="group relative flex items-center justify-between gap-3 overflow-hidden rounded-xl border border-border bg-surface p-4 pl-5 shadow-sm transition-colors hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <span aria-hidden="true" className="absolute left-0 top-0 h-full w-1 bg-accent" />
                <div className="min-w-0">
                  <p className="font-display text-base font-semibold text-foreground">
                    {tr('publicApp.eventHome.schedule.tournamentsCard')}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {firstPoolStart
                      ? `${tr('publicApp.eventHome.tournament.firstPool')}: ${formatInZone(firstPoolStart, tz, dateTimeFmt, tag)}`
                      : tr('publicApp.eventHome.schedule.notScheduled')}
                  </p>
                </div>
                <span className="shrink-0 font-semibold text-accent group-hover:text-accent-hover">
                  →
                </span>
              </Link>
            )}
            {workshops.length > 0 && (
              <Link
                href={`/e/${eventSlug}/schedule/workshops`}
                className="group relative flex items-center justify-between gap-3 overflow-hidden rounded-xl border border-border bg-surface p-4 pl-5 shadow-sm transition-colors hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <span aria-hidden="true" className="absolute left-0 top-0 h-full w-1 bg-gold" />
                <div className="min-w-0">
                  <p className="font-display text-base font-semibold text-foreground">
                    {tr('publicApp.eventHome.schedule.workshopsCard')}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {wsFirstStart
                      ? `${formatInZone(wsFirstStart, tz, dateTimeFmt, tag)}${wsLastEnd ? ` → ${formatInZone(wsLastEnd, tz, dateTimeFmt, tag)}` : ''}`
                      : tr('publicApp.eventHome.schedule.notScheduled')}
                  </p>
                </div>
                <span className="shrink-0 font-semibold text-accent group-hover:text-accent-hover">
                  →
                </span>
              </Link>
            )}
          </div>
        </section>
      )}

      {venues.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {tr('publicApp.eventHome.section.venues')}
          </h2>
          <div className={CARD_SCROLL_2}>
            {venues.map((v) => {
              const mapsHref = v.address
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address)}`
                : null;
              return (
                <article
                  key={v.id}
                  className={`flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-sm ${SCROLL_ITEM}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-display text-base font-semibold text-foreground">
                        {v.name}
                      </p>
                      {v.address && <p className="mt-0.5 text-xs text-muted">{v.address}</p>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {v.hosts_tournament && (
                        <span className="rounded-full bg-info/10 px-2 py-0.5 text-xs font-semibold text-info">
                          {tr('publicApp.eventHome.schedule.tournament')}
                        </span>
                      )}
                      {v.hosts_workshop && (
                        <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                          {tr('publicApp.eventHome.schedule.workshop')}
                        </span>
                      )}
                    </div>
                  </div>
                  {v.venue_areas && v.venue_areas.length > 0 && (
                    <p className="text-xs text-muted">
                      {tr(
                        v.venue_areas.length === 1
                          ? 'publicApp.eventHome.venues.areaCountSingular'
                          : 'publicApp.eventHome.venues.areaCountPlural',
                        {
                          count: v.venue_areas.length,
                          names: v.venue_areas.map((a) => a.name).join(' · '),
                        },
                      )}
                    </p>
                  )}
                  {mapsHref && (
                    <a
                      href={mapsHref}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-xs font-semibold text-accent hover:text-accent-hover"
                    >
                      {tr('publicApp.eventHome.venues.openInMaps')}
                    </a>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {!isCompleted && (
        <LiveNowSection
          eventSlug={eventSlug}
          initialHighlights={highlights}
          workshops={workshops}
          tz={tz}
          nowIso={new Date().toISOString()}
        />
      )}

      {isCompleted && (
        <section className="border-t border-border pt-6">
          <p className="mb-3 text-sm text-foreground-secondary">
            {tr('publicApp.eventHome.cta.eventOver')}
          </p>
          {tournaments[0] && (
            <Link
              href={`/e/${eventSlug}/t/${encodeURIComponent(tournaments[0].slug)}`}
              className="inline-block rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              {tr('publicApp.eventHome.cta.viewResults')}
            </Link>
          )}
        </section>
      )}
    </main>
  );
}
