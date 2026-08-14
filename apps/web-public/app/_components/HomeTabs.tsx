'use client';

import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';
import { EventsListSections } from './EventsListSections';
import { PublicLeaguesSections, type PublicLeague } from './PublicLeaguesSections';
import { PublicFightersPreview } from './PublicFightersPreview';
import type { DirectoryApiFighter } from '../fighters/fighter-row-model';
import type { WeaponOption } from './EventFilterBar';
import {
  DEFAULT_CATALOG_TAB,
  EMPTY_EVENT_FILTERS,
  toCatalogQueryString,
  type CatalogTab,
  type EventFilters,
} from './event-filters';

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
  leagues?: Array<{ id: string; name: string; slug: string }> | null;
  organizations?: {
    name?: string | null;
    slug?: string | null;
    logo_url?: string | null;
    brand_color?: string | null;
  } | null;
}

/** Tab id → its label key. One place to add the third tab. */
const TAB_LABEL_KEYS: ReadonlyArray<readonly [CatalogTab, string]> = [
  ['events', 'publicApp.home.tabEvents'],
  ['leagues', 'publicApp.home.tabLeagues'],
  ['fighters', 'publicApp.home.tabFighters'],
];

/**
 * One tab, as an anchor.
 *
 * `href` carries the current filters, so switching tabs does not silently
 * discard a search the reader typed on the other one.
 */
function TabLink({
  value,
  label,
  active,
  filters,
}: {
  value: CatalogTab;
  label: string;
  active: boolean;
  filters: EventFilters;
}) {
  const qs = toCatalogQueryString(filters, value);
  return (
    <Link
      href={qs ? `/?${qs}` : '/'}
      role="tab"
      aria-selected={active}
      scroll={false}
      className={[
        'rounded px-3 py-1.5 text-sm font-semibold transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-foreground-secondary hover:bg-background',
      ].join(' ')}
    >
      {label}
    </Link>
  );
}

/**
 * Tabs as links, not buttons.
 *
 * The tab used to be local `useState`, so the catalogue had one address whatever
 * you were looking at: a link to the leagues list was unshareable, the back
 * button skipped past it, and the server rendered Events every time. Anchors put
 * the state where the rest of this page already keeps it — the URL.
 */
function TabRow({ tab, filters }: { tab: CatalogTab; filters: EventFilters }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div
        role="tablist"
        aria-label={t('publicApp.home.tabsLabel')}
        className="inline-flex self-start rounded-md border border-border bg-surface p-1 shadow-sm"
      >
        {TAB_LABEL_KEYS.map(([value, labelKey]) => (
          <TabLink
            key={value}
            value={value}
            label={t(labelKey)}
            active={tab === value}
            filters={filters}
          />
        ))}
      </div>
      {/* The event cards below are anchors end to end, so the organiser name
          inside a card cannot itself link. This is the way to the directory. */}
      <Link
        href="/organisers"
        className="text-sm font-semibold text-accent hover:text-accent-hover hover:underline"
      >
        {t('publicApp.organisers.browseCta')}
      </Link>
    </div>
  );
}

export function HomeTabs({
  events,
  leagues,
  fighters = [],
  weapons = [],
  filters = EMPTY_EVENT_FILTERS,
  tab = DEFAULT_CATALOG_TAB,
}: {
  events: PublicEvent[];
  leagues: PublicLeague[];
  fighters?: DirectoryApiFighter[];
  weapons?: WeaponOption[];
  filters?: EventFilters;
  tab?: CatalogTab;
}) {
  return (
    <div className="flex flex-col gap-6">
      <TabRow tab={tab} filters={filters} />
      {tab === 'events' && (
        <EventsListSections events={events} weapons={weapons} filters={filters} tab={tab} />
      )}
      {tab === 'leagues' && <PublicLeaguesSections leagues={leagues} />}
      {tab === 'fighters' && <PublicFightersPreview fighters={fighters} />}
    </div>
  );
}
