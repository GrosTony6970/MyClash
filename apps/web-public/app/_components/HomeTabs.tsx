'use client';

import { useState } from 'react';
import { t } from '@myclash/i18n';
import { EventsListSections } from './EventsListSections';
import { PublicLeaguesSections, type PublicLeague } from './PublicLeaguesSections';
import type { WeaponOption } from './EventFilterBar';
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

type Tab = 'events' | 'leagues';

export function HomeTabs({
  events,
  leagues,
  weapons = [],
  filters = EMPTY_EVENT_FILTERS,
  personal = false,
}: {
  events: PublicEvent[];
  leagues: PublicLeague[];
  weapons?: WeaponOption[];
  filters?: EventFilters;
  personal?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('events');
  return (
    <div className="flex flex-col gap-6">
      <div className="inline-flex self-start rounded-md border border-border bg-surface p-1 shadow-sm">
        {(
          [
            ['events', t('publicApp.home.tabEvents')],
            ['leagues', t('publicApp.home.tabLeagues')],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={[
              'rounded px-3 py-1.5 text-sm font-semibold transition-colors',
              tab === value
                ? 'bg-accent text-accent-foreground'
                : 'text-foreground-secondary hover:bg-background',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'events' && (
        <EventsListSections
          events={events}
          weapons={weapons}
          filters={filters}
          personal={personal}
        />
      )}
      {tab === 'leagues' && <PublicLeaguesSections leagues={leagues} />}
    </div>
  );
}
