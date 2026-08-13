'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { defaultLocale } from '@myclash/i18n';
import { EventKindBadge, formatCountryName } from '@myclash/ui';
import { DEFAULT_ORG_ACCENT, asEventKind } from '@myclash/types';
import { useI18n, type Translator } from '@myclash/next-i18n/client';
import { partitionEvents } from './filter-events';
import { emptySectionMessageKey, type SectionKey } from './empty-section-message-key';
import { formatDateRange } from './format-date-range';
import { EventFilterBar, type WeaponOption } from './EventFilterBar';
import { EMPTY_EVENT_FILTERS, type EventFilters } from './event-filters';

interface PublicEvent {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  city?: string | null;
  country?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  // 'standard' | 'club' here — the API never returns test events publicly.
  event_kind?: string | null;
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

function formatEventLocation(event: PublicEvent): string | null {
  const countryName = formatCountryName(event.country, defaultLocale);
  const parts = [event.city, countryName].filter((v): v is string => Boolean(v));
  return parts.length === 0 ? null : parts.join(', ');
}

function eventHref(event: PublicEvent): string {
  return `/e/${encodeURIComponent(event.slug ?? event.id ?? '')}/home`;
}

// Takes the translator rather than importing one: this runs at module scope,
// where no hook can be called, and the module-level `t` is permanently English.
function tournamentCountLabel(t: Translator, n: number | null | undefined): string {
  const count = n ?? 0;
  return count === 1
    ? t('publicApp.home.tournamentCountSingular').replace('{count}', '1')
    : t('publicApp.home.tournamentCountPlural').replace('{count}', String(count));
}

function orgAccent(event: PublicEvent): string {
  return event.organizations?.brand_color || DEFAULT_ORG_ACCENT;
}

// Shared column template for the events list. The header strip and every row
// are independent grid containers, so the non-fractional columns must be FIXED
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

export function EventsListSections({
  events,
  weapons = [],
  filters = EMPTY_EVENT_FILTERS,
}: {
  events: PublicEvent[];
  weapons?: WeaponOption[];
  filters?: EventFilters;
}) {
  const { live, published, past } = useMemo(() => partitionEvents(events), [events]);
  // Display-only: the sections no longer filter on it, but the empty-state copy
  // still says "no live events match {query}".
  const query = filters.q ?? '';

  return (
    <div className="flex w-full flex-col gap-10">
      <EventFilterBar filters={filters} weapons={weapons} resultCount={events.length} />

      <LiveSection events={live} query={query} />
      <UpcomingSection events={published} query={query} />
      <PastSection events={past} query={query} />
    </div>
  );
}

function EmptySectionMessage({ sectionKey, query }: { sectionKey: SectionKey; query: string }) {
  const { t } = useI18n();

  const trimmed = query.trim();
  const message = t(emptySectionMessageKey(sectionKey, trimmed)).replace('{query}', trimmed);
  return (
    <p className="rounded-lg border border-dashed border-border bg-background p-6 text-center text-sm text-muted">
      {message}
    </p>
  );
}

function SectionHeader({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="font-display text-lg font-semibold text-foreground sm:text-xl">
        {title}
      </h2>
      <span className="text-xs text-muted">{count}</span>
    </div>
  );
}

/**
 * Organiser + dates line above each card's title.
 *
 * The organiser name is its own link to /o/[slug]. It only works because the
 * card is no longer an anchor: the card's click target is now the title's
 * stretched ::after overlay (see CARD_SHELL), and `relative z-10` lifts this
 * link above that overlay so it wins the click on its own text.
 */
function OrganiserEyebrow({ event }: { event: PublicEvent }) {
  const { locale } = useI18n();
  const orgName = event.organizations?.name;
  const orgSlug = event.organizations?.slug;
  const orgLogo = event.organizations?.logo_url;
  const dateRange = formatDateRange(event, locale);
  if (!orgName && !orgLogo && !dateRange) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-foreground-secondary">
      {orgLogo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={orgLogo}
          alt=""
          width={20}
          height={20}
          className="h-5 w-5 rounded-full border border-border bg-surface object-contain"
        />
      )}
      {orgName &&
        (orgSlug ? (
          <Link
            href={`/o/${orgSlug}`}
            className="relative z-10 font-semibold text-foreground-secondary hover:text-accent hover:underline"
          >
            {orgName}
          </Link>
        ) : (
          <span className="font-semibold text-foreground-secondary">{orgName}</span>
        ))}
      {orgName && dateRange && <span aria-hidden="true">·</span>}
      {dateRange && <span>{dateRange}</span>}
    </div>
  );
}

/**
 * Card shell + the overlay that makes the whole card clickable.
 *
 * The card used to BE the `<a>`, which is why the organiser inside it could not
 * link anywhere — nested anchors are invalid HTML and React hydration rejects
 * them. Instead the shell is a plain box and the event TITLE carries the link,
 * stretched over the whole card with an empty absolutely-positioned ::after.
 * One real anchor, named by the event title, with the same click area as
 * before; anything that needs to stay clickable on top of it (the organiser)
 * opts out with `relative z-10`.
 */
const CARD_SHELL =
  'group relative rounded-lg border border-border border-l-4 bg-surface p-4 shadow-sm transition-colors hover:border-accent focus-within:border-accent focus-within:ring-2 focus-within:ring-accent';
const CARD_TITLE_LINK = "block after:absolute after:inset-0 after:content-[''] focus:outline-none";

function EventLogo({ src, alt }: { src: string | null | undefined; alt: string }) {
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={40}
      height={40}
      className="h-10 w-10 shrink-0 rounded border border-border bg-surface object-contain"
    />
  );
}

function LiveTag() {
  const { t } = useI18n();

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-success/60 bg-success/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-success">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse"
      />
      {t('publicApp.home.liveTag')}
    </span>
  );
}

function PublishedTag() {
  const { t } = useI18n();

  return (
    <span className="inline-flex items-center rounded-full border border-info/40 bg-info/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-info">
      {t('publicApp.home.publishedTag')}
    </span>
  );
}

/** Club events are public but unrated — say so, or their standings look like
 *  results that count. See the API's countsTowardStats gate. */
function ClubTag({ event, className }: { event: PublicEvent; className?: string }) {
  const { t } = useI18n();

  return (
    <EventKindBadge
      kind={asEventKind(event.event_kind)}
      label={t('publicApp.eventKind.clubBadge')}
      title={t('publicApp.eventKind.clubBadgeHelp')}
      className={className}
    />
  );
}

function PastTag() {
  const { t } = useI18n();

  return (
    <span className="inline-flex items-center rounded-full border border-border bg-border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
      {t('publicApp.home.pastTag')}
    </span>
  );
}

function LiveSection({ events, query }: { events: PublicEvent[]; query: string }) {
  const { t } = useI18n();

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
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {events.map((event) => (
            <li
              key={event.slug ?? event.id}
              style={{ borderLeftColor: orgAccent(event) }}
              className={`${CARD_SHELL} flex min-h-44 flex-col justify-between`}
            >
              <div className="flex flex-col gap-3">
                <OrganiserEyebrow event={event} />
                <div className="flex items-start gap-3">
                  <EventLogo src={event.logo_url} alt={event.name ?? ''} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={eventHref(event)}
                      className={`${CARD_TITLE_LINK} font-display text-lg font-semibold leading-tight text-foreground`}
                    >
                      {event.name ?? t('publicApp.home.unknownEvent')}
                    </Link>
                    {(() => {
                      const place = formatEventLocation(event);
                      return place ? <p className="mt-1 text-sm text-muted">{place}</p> : null;
                    })()}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <LiveTag />
                    <ClubTag event={event} />
                  </div>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted">
                  {tournamentCountLabel(t, event.tournament_count)}
                </span>
                <span className="font-semibold text-accent group-hover:text-accent-hover">
                  {t('publicApp.home.openEvent')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface EventRowProps {
  event: PublicEvent;
  variant: 'published' | 'past';
  hasLogos: boolean;
}

function EventRow({ event, variant, hasLogos }: EventRowProps) {
  const { t } = useI18n();

  const tag = variant === 'published' ? <PublishedTag /> : <PastTag />;
  const trailing =
    variant === 'past' ? (
      (() => {
        const resultsReady = event.status === 'completed' && (event.tournament_count ?? 0) > 0;
        return (
          <span
            className={resultsReady ? 'font-semibold text-accent' : 'text-xs italic text-muted'}
          >
            {resultsReady ? t('publicApp.home.resultsReady') : t('publicApp.home.resultsPending')}
          </span>
        );
      })()
    ) : (
      <span className="text-sm text-muted">{tournamentCountLabel(t, event.tournament_count)}</span>
    );

  return (
    <li
      style={{ borderLeftColor: orgAccent(event) }}
      className={`${CARD_SHELL} flex flex-col gap-3`}
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
          <Link
            href={eventHref(event)}
            className={`${CARD_TITLE_LINK} font-display text-base font-semibold leading-tight text-foreground`}
          >
            {event.name ?? t('publicApp.home.unknownEvent')}
          </Link>
          <ClubTag event={event} className="mt-1.5" />
        </div>
        <p className="text-sm text-muted">
          <span className="font-medium text-foreground-secondary md:hidden">
            {t('publicApp.home.colLocation')} ·{' '}
          </span>
          {formatEventLocation(event) ?? '—'}
        </p>
        <p className="text-sm text-muted">
          <span className="font-medium text-foreground-secondary md:hidden">
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
    </li>
  );
}

/**
 * The desktop column labels.
 *
 * Purely presentational, and marked so. This used to claim `role="row"` with
 * `role="columnheader"` children inside a `role="table"` whose rows carried no
 * `role="row"` at all — an ARIA table with a header and no data, which assistive
 * tech announces as an empty table. The markup underneath is a list of cards
 * that happens to align into columns above `md`, so the list is now a real
 * <ul>/<li> and this strip is hidden from the accessibility tree. Each row
 * already repeats its own labels inline on mobile ("Location · …"), which is
 * what carries the meaning for a screen reader.
 */
function EventListHeader({
  variant,
  hasLogos,
}: {
  variant: 'published' | 'past';
  hasLogos: boolean;
}) {
  const { t } = useI18n();

  // The transparent 4px left border mirrors each row's colored `border-l-4` so
  // the header labels line up exactly above the row content (the row's border
  // sits outside its padding, shifting its content 4px to the right).
  const headerClass = `hidden md:grid ${gridColsClass(hasLogos)} md:items-center md:gap-4 md:border-b md:border-l-4 md:border-border md:border-l-transparent md:px-4 md:py-2 md:text-xs md:font-semibold md:uppercase md:tracking-wider md:text-muted`;
  return (
    <div aria-hidden="true" className={headerClass}>
      {hasLogos && <span />}
      <span>{t('publicApp.home.colEvent')}</span>
      <span>{t('publicApp.home.colLocation')}</span>
      <span>{t('publicApp.home.colLeague')}</span>
      <span>
        {variant === 'past' ? t('publicApp.home.colResults') : t('publicApp.home.colTournaments')}
      </span>
      <span className="md:justify-self-end" />
    </div>
  );
}

function UpcomingSection({ events, query }: { events: PublicEvent[]; query: string }) {
  const { t } = useI18n();

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
        <div>
          <EventListHeader variant="published" hasLogos={hasLogos} />
          {/* No max-height/overflow here any more. The scrollport existed to keep
              the fake table's header row in view; with the table gone its only
              remaining effect was a scroll region nested inside page scroll,
              which on a phone steals the swipe. */}
          <ul className="flex flex-col gap-3">
            {events.map((event) => (
              <EventRow
                key={event.slug ?? event.id}
                event={event}
                variant="published"
                hasLogos={hasLogos}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function PastSection({ events, query }: { events: PublicEvent[]; query: string }) {
  const { t } = useI18n();

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
        <div>
          <EventListHeader variant="past" hasLogos={hasLogos} />
          <ul className="flex flex-col gap-3">
            {events.map((event) => (
              <EventRow
                key={event.slug ?? event.id}
                event={event}
                variant="past"
                hasLogos={hasLogos}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
