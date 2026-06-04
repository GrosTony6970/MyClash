'use client';

import { useState } from 'react';
import { t } from '@myclash/i18n';
import { EventsListSections } from './EventsListSections';
import { PublicLeaguesSections, type PublicLeague } from './PublicLeaguesSections';

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
  leagues?: Array<{ id: string; name: string; slug: string }> | null;
  organizations?: {
    name?: string | null;
    slug?: string | null;
    logo_url?: string | null;
    brand_color?: string | null;
  } | null;
}

type Tab = 'events' | 'leagues';

export function HomeTabs({ events, leagues }: { events: PublicEvent[]; leagues: PublicLeague[] }) {
  const [tab, setTab] = useState<Tab>('events');
  return (
    <div className="flex flex-col gap-6">
      <div className="inline-flex self-start rounded-md border border-stone-200 bg-white p-1 shadow-sm">
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
              tab === value ? 'bg-red-700 text-white' : 'text-slate-600 hover:bg-stone-100',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'events' && <EventsListSections events={events} />}
      {tab === 'leagues' && <PublicLeaguesSections leagues={leagues} />}
    </div>
  );
}
