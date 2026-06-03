'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { t } from '@myclash/i18n';

interface VenueArea {
  id: string;
  name: string;
  sort_order: number;
}

interface EventVenue {
  id: string;
  organization_id: string;
  name: string;
  address: string | null;
  hosts_tournament: boolean;
  hosts_workshop: boolean;
  venue_areas: VenueArea[] | null;
}

interface LiceRow {
  id: string;
  name: string;
  venue_id: string | null;
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

/**
 * Event-scoped Venue tab. Lists every venue this event uses
 * (derived from lices + workshop sessions). Each card shows the
 * venue's address, capability badges, areas, and the lices from
 * this event that sit in it. Operators manage the catalogue itself
 * — including create / delete and global edits — from
 * /org/<slug>/venues.
 */
export default function EventVenuesPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const slug = params.slug ?? '';
  const eventId = params.eventId ?? '';

  const [venues, setVenues] = useState<EventVenue[]>([]);
  const [licesByVenue, setLicesByVenue] = useState<Map<string, LiceRow[]>>(() => new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [venuesRes, licesRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/events/${eventId}/venues`, { credentials: 'include' }),
        fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, { credentials: 'include' }),
      ]);
      if (venuesRes.ok) setVenues((await venuesRes.json()) as EventVenue[]);
      if (licesRes.ok) {
        const lices = (await licesRes.json()) as LiceRow[];
        const map = new Map<string, LiceRow[]>();
        for (const lice of lices) {
          if (!lice.venue_id) continue;
          const arr = map.get(lice.venue_id) ?? [];
          arr.push(lice);
          map.set(lice.venue_id, arr);
        }
        setLicesByVenue(map);
      }
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    void load();
  }, [eventId, load]);

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('organizer.eventVenues.title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('organizer.eventVenues.description')}</p>
        </div>
        <Link
          href={`/org/${slug}/venues`}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          {t('organizer.eventVenues.manageCatalogue')}
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">{t('admin.leagues.loading')}</p>
      ) : venues.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 max-w-3xl">
          <p className="text-sm text-gray-700">{t('organizer.eventVenues.empty')}</p>
          <p className="mt-2 text-xs text-gray-500">{t('organizer.eventVenues.emptyHint')}</p>
        </div>
      ) : (
        <div className="space-y-4 max-w-3xl">
          {venues.map((v) => {
            const lices = licesByVenue.get(v.id) ?? [];
            return (
              <article key={v.id} className="rounded-lg border border-gray-200 bg-white p-5">
                <header className="mb-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-gray-900">{v.name}</h3>
                    <div className="flex flex-wrap gap-1">
                      {v.hosts_tournament && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                          {t('organizer.venues.tournamentBadge')}
                        </span>
                      )}
                      {v.hosts_workshop && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                          {t('organizer.venues.workshopBadge')}
                        </span>
                      )}
                    </div>
                  </div>
                  {v.address && <p className="text-xs text-gray-500 mt-1">{v.address}</p>}
                </header>

                {lices.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                      {t('organizer.eventVenues.lices')}
                    </p>
                    <ul className="space-y-1 text-sm text-gray-800">
                      {lices.map((lice) => (
                        <li key={lice.id}>· {lice.name}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {v.venue_areas && v.venue_areas.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                      {t('organizer.venues.areas')}
                    </p>
                    <ul className="space-y-1 text-sm text-gray-800">
                      {v.venue_areas.map((area) => (
                        <li key={area.id}>· {area.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
