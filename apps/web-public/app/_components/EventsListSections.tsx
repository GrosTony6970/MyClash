'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { t } from '@myclash/i18n';
import { partitionAndFilterEvents } from './filter-events';
import { emptySectionMessageKey, type SectionKey } from './empty-section-message-key';
import { formatDateRange } from './format-date-range';

interface PublicEvent {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  logo_url?: string | null;
  tournament_count?: number | null;
  organizations?: {
    name?: string | null;
    slug?: string | null;
    logo_url?: string | null;
  } | null;
}

function eventHref(event: PublicEvent): string {
  return `/e/${encodeURIComponent(event.slug ?? event.id ?? '')}/home`;
}

function tournamentCountLabel(n: number | null | undefined): string {
  const count = n ?? 0;
  return count === 1
    ? t('publicApp.home.tournamentCountSingular').replace('{count}', '1')
    : t('publicApp.home.tournamentCountPlural').replace('{count}', String(count));
}

export function EventsListSections({ events }: { events: PublicEvent[] }) {
  const [query, setQuery] = useState('');
  const { live, published, past } = useMemo(
    () => partitionAndFilterEvents(events, query),
    [events, query],
  );

  return (
    <div className="flex w-full flex-col gap-10">
      <section aria-labelledby="public-events-search-label" className="flex flex-col gap-2">
        <label
          id="public-events-search-label"
          htmlFor="public-events-search"
          className="text-xs font-semibold uppercase tracking-wider text-neutral-500"
        >
          {t('publicApp.home.searchLabel')}
        </label>
        <input
          id="public-events-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('publicApp.home.searchPlaceholder')}
          className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 sm:max-w-md"
        />
      </section>

      <LiveSection events={live} query={query} />
      <UpcomingSection events={published} query={query} />
      <PastSection events={past} query={query} />
    </div>
  );
}

/**
 * Empty-state placeholder shown when a section has zero events. Uses
 * the trimmed search query to choose between a generic message and a
 * "no matches" message, so the operator can see at a glance whether
 * the search is hiding everything or there genuinely aren't any
 * events. Replaces the previous `return null` guards on each
 * section, which made the page reflow whenever the search shrank a
 * section to zero.
 */
function EmptySectionMessage({ sectionKey, query }: { sectionKey: SectionKey; query: string }) {
  const trimmed = query.trim();
  const message = t(emptySectionMessageKey(sectionKey, trimmed)).replace('{query}', trimmed);
  return (
    <p className="rounded-lg border border-dashed border-neutral-800 bg-neutral-900/50 p-6 text-center text-sm text-neutral-500">
      {message}
    </p>
  );
}

function SectionHeader({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-base font-semibold text-neutral-200 sm:text-lg">
        {title}
      </h2>
      <span className="text-xs text-neutral-500">{count}</span>
    </div>
  );
}

function LogoStack({
  eventLogo,
  orgLogo,
  alt,
}: {
  eventLogo: string | null | undefined;
  orgLogo: string | null | undefined;
  alt: string;
}) {
  if (!eventLogo && !orgLogo) return null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* Operator-uploaded logos live on Supabase storage URLs that we
       *  can't pre-declare in next.config; using plain <img> avoids the
       *  remotePatterns whitelist requirement. The brand logo in the
       *  SiteHeader stays as next/image. */}
      {eventLogo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={eventLogo}
          alt={alt}
          width={40}
          height={40}
          className="h-10 w-10 rounded border border-neutral-800 bg-neutral-900 object-contain"
        />
      )}
      {orgLogo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={orgLogo}
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 rounded-full border border-neutral-800 bg-neutral-900 object-contain"
        />
      )}
    </div>
  );
}

function LiveTag() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-emerald-300">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse"
      />
      {t('publicApp.home.liveTag')}
    </span>
  );
}

function PublishedTag() {
  return (
    <span className="inline-flex items-center rounded-full border border-sky-300/40 bg-sky-500/15 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-sky-200">
      {t('publicApp.home.publishedTag')}
    </span>
  );
}

function PastTag() {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-500/40 bg-slate-500/15 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
      {t('publicApp.home.pastTag')}
    </span>
  );
}

function LiveSection({ events, query }: { events: PublicEvent[]; query: string }) {
  return (
    <section aria-labelledby="public-events-live-title" className="flex flex-col gap-4">
      <SectionHeader
        id="public-events-live-title"
        title={t('publicApp.home.sectionLive')}
        count={events.length}
      />
      {events.length === 0 ? (
        <EmptySectionMessage sectionKey="live" query={query} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {events.map((event) => (
            <Link
              key={event.slug ?? event.id}
              href={eventHref(event)}
              className="group flex min-h-44 flex-col justify-between rounded-lg border border-emerald-500/30 bg-neutral-900 p-4 transition-colors hover:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <LogoStack
                    eventLogo={event.logo_url}
                    orgLogo={event.organizations?.logo_url}
                    alt={event.name ?? ''}
                  />
                  <LiveTag />
                </div>
                <div>
                  <p className="text-lg font-bold text-white">
                    {event.name ?? t('publicApp.home.unknownEvent')}
                  </p>
                  {event.organizations?.name && (
                    <p className="mt-1 text-sm text-neutral-400">{event.organizations.name}</p>
                  )}
                  {event.location && (
                    <p className="mt-1 text-sm text-neutral-500">{event.location}</p>
                  )}
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-neutral-400">{formatDateRange(event)}</span>
                <span className="text-neutral-500">
                  {tournamentCountLabel(event.tournament_count)}
                </span>
                <span className="font-semibold text-emerald-400 group-hover:text-emerald-300">
                  {t('publicApp.home.openEvent')}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

interface TableRowProps {
  event: PublicEvent;
  variant: 'published' | 'past';
}

function EventRow({ event, variant }: TableRowProps) {
  const tag = variant === 'published' ? <PublishedTag /> : <PastTag />;
  const trailing =
    variant === 'past' ? (
      (() => {
        const resultsReady = event.status === 'completed' && (event.tournament_count ?? 0) > 0;
        return (
          <span
            className={
              resultsReady ? 'font-semibold text-emerald-400' : 'text-xs text-neutral-500 italic'
            }
          >
            {resultsReady ? t('publicApp.home.resultsReady') : t('publicApp.home.resultsPending')}
          </span>
        );
      })()
    ) : (
      <span className="text-sm text-neutral-400">
        {tournamentCountLabel(event.tournament_count)}
      </span>
    );

  return (
    <Link
      href={eventHref(event)}
      className="group flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4 transition-colors hover:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 md:grid md:grid-cols-[auto_2fr_1fr_1fr_auto_auto] md:items-center md:gap-4"
    >
      <div className="flex items-start gap-3 md:contents">
        <div className="md:row-auto">
          <LogoStack
            eventLogo={event.logo_url}
            orgLogo={event.organizations?.logo_url}
            alt={event.name ?? ''}
          />
        </div>
        <div className="flex-1 md:row-auto">
          <p className="text-base font-bold text-white">
            {event.name ?? t('publicApp.home.unknownEvent')}
          </p>
          {event.organizations?.name && (
            <p className="mt-0.5 text-xs text-neutral-400">{event.organizations.name}</p>
          )}
        </div>
      </div>
      <p className="text-sm text-neutral-400 md:text-sm">
        <span className="font-medium text-neutral-500 md:hidden">
          {t('publicApp.home.colLocation')} ·{' '}
        </span>
        {event.location ?? '—'}
      </p>
      <p className="text-sm text-neutral-400">
        <span className="font-medium text-neutral-500 md:hidden">
          {t('publicApp.home.colDate')} ·{' '}
        </span>
        {formatDateRange(event) ?? '—'}
      </p>
      <div>{trailing}</div>
      <div>{tag}</div>
    </Link>
  );
}

function EventTableHeader({ variant }: { variant: 'published' | 'past' }) {
  return (
    <div
      role="row"
      className="hidden md:grid md:grid-cols-[auto_2fr_1fr_1fr_auto_auto] md:items-center md:gap-4 md:border-b md:border-neutral-800 md:px-4 md:py-2 md:text-xs md:font-semibold md:uppercase md:tracking-wider md:text-neutral-500"
    >
      <span role="columnheader" aria-label={t('publicApp.home.colLogo')}>
        {' '}
      </span>
      <span role="columnheader">{t('publicApp.home.colEvent')}</span>
      <span role="columnheader">{t('publicApp.home.colLocation')}</span>
      <span role="columnheader">{t('publicApp.home.colDate')}</span>
      <span role="columnheader">
        {variant === 'past' ? t('publicApp.home.colResults') : t('publicApp.home.colTournaments')}
      </span>
      <span role="columnheader" aria-label={t('publicApp.home.colStatus')}>
        {' '}
      </span>
    </div>
  );
}

function UpcomingSection({ events, query }: { events: PublicEvent[]; query: string }) {
  return (
    <section aria-labelledby="public-events-published-title" className="flex flex-col gap-3">
      <SectionHeader
        id="public-events-published-title"
        title={t('publicApp.home.sectionPublished')}
        count={events.length}
      />
      {events.length === 0 ? (
        <EmptySectionMessage sectionKey="upcoming" query={query} />
      ) : (
        <div role="table" aria-labelledby="public-events-published-title">
          <EventTableHeader variant="published" />
          <div className="flex flex-col gap-2 md:gap-0 md:divide-y md:divide-neutral-800">
            {events.map((event) => (
              <EventRow key={event.slug ?? event.id} event={event} variant="published" />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PastSection({ events, query }: { events: PublicEvent[]; query: string }) {
  return (
    <section aria-labelledby="public-events-past-title" className="flex flex-col gap-3">
      <SectionHeader
        id="public-events-past-title"
        title={t('publicApp.home.sectionPast')}
        count={events.length}
      />
      {events.length === 0 ? (
        <EmptySectionMessage sectionKey="past" query={query} />
      ) : (
        <div
          role="table"
          aria-labelledby="public-events-past-title"
          className="max-h-[60vh] overflow-y-auto"
        >
          <EventTableHeader variant="past" />
          <div className="flex flex-col gap-2 md:gap-0 md:divide-y md:divide-neutral-800">
            {events.map((event) => (
              <EventRow key={event.slug ?? event.id} event={event} variant="past" />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
