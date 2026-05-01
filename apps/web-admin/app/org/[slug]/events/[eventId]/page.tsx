'use client';

/**
 * Event detail / hub page
 * Route: /org/[slug]/events/[eventId]
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Tournament {
  id: string;
  slug: string;
  name: string;
  status: string;
}

interface EventInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
  startDate: string;
  endDate: string;
  location: string | null;
}

export default function EventDetailPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([evRes, tourRes]) => {
        if (evRes.ok) setEvent((await evRes.json()) as EventInfo);
        if (tourRes.ok) setTournaments((await tourRes.json()) as Tournament[]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eventId, apiUrl]);

  const sections = [
    { label: 'Persons & Roster', href: `persons`, icon: '👥' },
    { label: 'Registrations', href: `registrations`, icon: '📋' },
    { label: 'Pools', href: `pools`, icon: '🏊' },
    { label: 'Pool Populator', href: `pool-populator`, icon: '⚙️' },
    { label: 'Bracket', href: `bracket`, icon: '🏆' },
    { label: 'Schedule', href: `schedule`, icon: '📅' },
    { label: 'Referees', href: `referees`, icon: '🏛️' },
    { label: 'Referee Assignments', href: `referee-assignments`, icon: '📌' },
    { label: 'Workshops', href: `workshops`, icon: '📚' },
    { label: 'Theme', href: `theme`, icon: '🎨' },
  ];

  return (
    <main className="p-8 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
        <Link href={`/org/${slug}`} className="hover:text-gray-700">
          {slug}
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{event?.name ?? eventId}</span>
      </div>

      {event && (
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{event.name}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {event.location && `${event.location} · `}
            {new Date(event.startDate).toLocaleDateString('fr-FR')}
            {event.startDate !== event.endDate &&
              ` – ${new Date(event.endDate).toLocaleDateString('fr-FR')}`}
          </p>
        </div>
      )}

      {/* Management sections */}
      <div className="grid grid-cols-2 gap-3 mb-8 sm:grid-cols-3">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={`/org/${slug}/events/${eventId}/${s.href}`}
            className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-red-300 hover:shadow-sm transition-all"
          >
            <span className="text-xl">{s.icon}</span>
            <span className="text-sm font-medium text-gray-700">{s.label}</span>
          </Link>
        ))}
      </div>

      {/* Exports */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">Exports</h2>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <div className="flex flex-col gap-3">
            {/* HEMA Ratings fighters */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">HEMA Ratings — fighters.csv</p>
                <p className="text-xs text-gray-500">
                  All participants: Name, Club, Nationality, HEMA Ratings ID
                </p>
              </div>
              <a
                href={`${apiUrl}/api/v1/events/${eventId}/exports/fighters.csv`}
                download="fighters.csv"
                className="text-sm font-medium text-red-700 hover:underline flex-shrink-0"
              >
                Download ↓
              </a>
            </div>

            {/* HEMA Ratings results per tournament */}
            {tournaments.map((t) => (
              <div key={t.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    HEMA Ratings — {t.name} results
                  </p>
                  <p className="text-xs text-gray-500">
                    Match results: Fighter1, Fighter2, Result, Round
                  </p>
                </div>
                <a
                  href={`${apiUrl}/api/v1/tournaments/${t.id}/exports/results.csv`}
                  download={`${t.slug}.csv`}
                  className="text-sm font-medium text-red-700 hover:underline flex-shrink-0"
                >
                  Download ↓
                </a>
              </div>
            ))}

            {/* Full CSV */}
            <div className="flex items-center justify-between border-t border-gray-200 pt-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Full export — exchanges.csv</p>
                <p className="text-xs text-gray-500">All matches + exchanges with clock times</p>
              </div>
              <a
                href={`${apiUrl}/api/v1/events/${eventId}/exports/full.csv`}
                download="exchanges.csv"
                className="text-sm font-medium text-gray-600 hover:underline flex-shrink-0"
              >
                Download ↓
              </a>
            </div>

            {/* Full JSON */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Full export — event.json</p>
                <p className="text-xs text-gray-500">Complete event data (round-trippable)</p>
              </div>
              <a
                href={`${apiUrl}/api/v1/events/${eventId}/exports/full.json`}
                download="event.json"
                className="text-sm font-medium text-gray-600 hover:underline flex-shrink-0"
              >
                Download ↓
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
