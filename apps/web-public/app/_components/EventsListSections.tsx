'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { defaultLocale, t } from '@myclash/i18n';
import { formatCountryName } from '@myclash/ui';
import { partitionAndFilterEvents } from './filter-events';
import { emptySectionMessageKey, type SectionKey } from './empty-section-message-key';
import { formatDateRange } from './format-date-range';

interface PublicEvent {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  city?: string | null;
  country?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  logo_url?: string | null;
  tournament_count?: number | null;
  // Distinct leagues this event participates in via its tournaments'
  // approved league_tournament_links. Projected by /api/v1/events.
  leagues?: Array<{ id: string; name: string; slug: string }> | null;
  organizations?: {
    name?: string | null;
    slug?: string | null;
    logo_url?: string | null;
    brand_color?: string | null;
  } | null;
}

const DEFAULT_ORG_ACCENT = '#dc2626';

function formatEventLocation(event: PublicEvent): string | null {
  const countryName = formatCountryName(event.country, defaultLocale);
  const parts = [event.city, countryName].filter((v): v is string => Boolean(v));
  return parts.length === 0 ? null : parts.join(', ');
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

function orgAccent(event: PublicEvent): string {
  return event.organizations?.brand_color || DEFAULT_ORG_ACCENT;
}

// Shared column template for the events table. The header and every row are
// independent grid containers, so the non-fractional columns must be FIXED
// (not `auto`) — otherwise each grid sizes its `auto` tracks to its own
// content (blank header vs the status badge, "TOURNAMENTS" vs "2 tournaments")
// and the `fr` columns drift between header and rows. Both literal strings are
// written out in full so Tailwind's scanner emits them. The logo column is
// dropped entirely when no event in the section has a logo, so a logo-less
// list isn't indented.
function gridColsClass(hasLogos: boolean): string {
  return hasLogos
    ? 'md:grid-cols-[2.5rem_2fr_1fr_1fr_7rem_6.5rem]'
    : 'md:grid-cols-[2fr_1fr_1fr_7rem_6.5rem]';
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
          className="text-xs font-semibold uppercase tracking-wider text-slate-500"
        >
          {t('publicApp.home.searchLabel')}
        </label>
        <input
          id="public-events-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('publicApp.home.searchPlaceholder')}
          className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/30 sm:max-w-md"
        />
      </section>

      <LiveSection events={live} query={query} />
      <UpcomingSection events={published} query={query} />
      <PastSection events={past} query={query} />
    </div>
  );
}

function EmptySectionMessage({ sectionKey, query }: { sectionKey: SectionKey; query: string }) {
  const trimmed = query.trim();
  const message = t(emptySectionMessageKey(sectionKey, trimmed)).replace('{query}', trimmed);
  return (
    <p className="rounded-lg border border-dashed border-stone-300 bg-stone-100 p-6 text-center text-sm text-slate-500">
      {message}
    </p>
  );
}

function SectionHeader({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="font-display text-lg font-semibold text-slate-900 sm:text-xl">
        {title}
      </h2>
      <span className="text-xs text-slate-500">{count}</span>
    </div>
  );
}

function OrganiserEyebrow({ event }: { event: PublicEvent }) {
  const orgName = event.organizations?.name;
  const orgLogo = event.organizations?.logo_url;
  const dateRange = formatDateRange(event);
  if (!orgName && !orgLogo && !dateRange) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-slate-600">
      {orgLogo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={orgLogo}
          alt=""
          width={20}
          height={20}
          className="h-5 w-5 rounded-full border border-stone-200 bg-white object-contain"
        />
      )}
      {orgName && <span className="font-semibold text-slate-700">{orgName}</span>}
      {orgName && dateRange && <span aria-hidden="true">·</span>}
      {dateRange && <span>{dateRange}</span>}
    </div>
  );
}

function EventLogo({ src, alt }: { src: string | null | undefined; alt: string }) {
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={40}
      height={40}
      className="h-10 w-10 shrink-0 rounded border border-stone-200 bg-white object-contain"
    />
  );
}

function LiveTag() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/60 bg-emerald-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-emerald-700">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse"
      />
      {t('publicApp.home.liveTag')}
    </span>
  );
}

function PublishedTag() {
  return (
    <span className="inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
      {t('publicApp.home.publishedTag')}
    </span>
  );
}

function PastTag() {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
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
              style={{ borderLeftColor: orgAccent(event) }}
              className="group flex min-h-44 flex-col justify-between rounded-lg border border-stone-200 border-l-4 bg-white p-4 shadow-sm transition-colors hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <div className="flex flex-col gap-3">
                <OrganiserEyebrow event={event} />
                <div className="flex items-start gap-3">
                  <EventLogo src={event.logo_url} alt={event.name ?? ''} />
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-lg font-semibold leading-tight text-slate-900">
                      {event.name ?? t('publicApp.home.unknownEvent')}
                    </p>
                    {(() => {
                      const place = formatEventLocation(event);
                      return place ? <p className="mt-1 text-sm text-slate-500">{place}</p> : null;
                    })()}
                  </div>
                  <LiveTag />
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-slate-500">
                  {tournamentCountLabel(event.tournament_count)}
                </span>
                <span className="font-semibold text-red-700 group-hover:text-red-800">
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
  hasLogos: boolean;
}

function EventRow({ event, variant, hasLogos }: TableRowProps) {
  const tag = variant === 'published' ? <PublishedTag /> : <PastTag />;
  const trailing =
    variant === 'past' ? (
      (() => {
        const resultsReady = event.status === 'completed' && (event.tournament_count ?? 0) > 0;
        return (
          <span
            className={
              resultsReady ? 'font-semibold text-red-700' : 'text-xs italic text-slate-500'
            }
          >
            {resultsReady ? t('publicApp.home.resultsReady') : t('publicApp.home.resultsPending')}
          </span>
        );
      })()
    ) : (
      <span className="text-sm text-slate-500">{tournamentCountLabel(event.tournament_count)}</span>
    );

  return (
    <Link
      href={eventHref(event)}
      style={{ borderLeftColor: orgAccent(event) }}
      className="group flex flex-col gap-3 rounded-lg border border-stone-200 border-l-4 bg-white p-4 shadow-sm transition-colors hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500"
    >
      <OrganiserEyebrow event={event} />
      <div
        className={`flex flex-col gap-3 md:grid ${gridColsClass(hasLogos)} md:items-center md:gap-4`}
      >
        {hasLogos &&
          (event.logo_url ? (
            <EventLogo src={event.logo_url} alt={event.name ?? ''} />
          ) : (
            // Keep the logo cell occupied so the remaining cells don't shift
            // left; hidden on mobile (flex stack) to avoid an empty gap row.
            <span aria-hidden="true" className="hidden md:block" />
          ))}
        <div className="min-w-0">
          <p className="font-display text-base font-semibold leading-tight text-slate-900">
            {event.name ?? t('publicApp.home.unknownEvent')}
          </p>
        </div>
        <p className="text-sm text-slate-500">
          <span className="font-medium text-slate-600 md:hidden">
            {t('publicApp.home.colLocation')} ·{' '}
          </span>
          {formatEventLocation(event) ?? '—'}
        </p>
        <p className="text-sm text-slate-500">
          <span className="font-medium text-slate-600 md:hidden">
            {t('publicApp.home.colLeague')} ·{' '}
          </span>
          {(() => {
            const leagues = event.leagues ?? [];
            if (leagues.length === 0) return '—';
            // Comma-join the names. Multiple-league nested links inside
            // an already-clickable row would be visually ambiguous, so
            // render plain text and let the operator click into the
            // event for the per-tournament league context.
            return leagues.map((l) => l.name).join(', ');
          })()}
        </p>
        <div>{trailing}</div>
        <div className="md:justify-self-end">{tag}</div>
      </div>
    </Link>
  );
}

function EventTableHeader({
  variant,
  hasLogos,
}: {
  variant: 'published' | 'past';
  hasLogos: boolean;
}) {
  // The transparent 4px left border mirrors each row's colored `border-l-4` so
  // the header labels line up exactly above the row content (the row's border
  // sits outside its padding, shifting its content 4px to the right).
  const headerClass = `hidden md:grid ${gridColsClass(hasLogos)} md:items-center md:gap-4 md:border-b md:border-l-4 md:border-stone-200 md:border-l-transparent md:px-4 md:py-2 md:text-xs md:font-semibold md:uppercase md:tracking-wider md:text-slate-500`;
  return (
    <div role="row" className={headerClass}>
      {hasLogos && (
        <span role="columnheader" aria-label={t('publicApp.home.colLogo')}>
          {' '}
        </span>
      )}
      <span role="columnheader">{t('publicApp.home.colEvent')}</span>
      <span role="columnheader">{t('publicApp.home.colLocation')}</span>
      <span role="columnheader">{t('publicApp.home.colLeague')}</span>
      <span role="columnheader">
        {variant === 'past' ? t('publicApp.home.colResults') : t('publicApp.home.colTournaments')}
      </span>
      <span
        role="columnheader"
        className="md:justify-self-end"
        aria-label={t('publicApp.home.colStatus')}
      >
        {' '}
      </span>
    </div>
  );
}

function UpcomingSection({ events, query }: { events: PublicEvent[]; query: string }) {
  const hasLogos = events.some((event) => Boolean(event.logo_url));
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
        <div
          role="table"
          aria-labelledby="public-events-published-title"
          className="max-h-[60vh] overflow-y-auto"
        >
          <EventTableHeader variant="published" hasLogos={hasLogos} />
          <div className="flex flex-col gap-3">
            {events.map((event) => (
              <EventRow
                key={event.slug ?? event.id}
                event={event}
                variant="published"
                hasLogos={hasLogos}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PastSection({ events, query }: { events: PublicEvent[]; query: string }) {
  const hasLogos = events.some((event) => Boolean(event.logo_url));
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
          <EventTableHeader variant="past" hasLogos={hasLogos} />
          <div className="flex flex-col gap-3">
            {events.map((event) => (
              <EventRow
                key={event.slug ?? event.id}
                event={event}
                variant="past"
                hasLogos={hasLogos}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
