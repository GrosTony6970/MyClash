'use client';

/**
 * Org dashboard — T-701
 * Route: /org/[slug]
 *
 * Shows event list + "New Event" CTA.
 * Events sorted by start_date desc.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface OrgEvent {
  id: string;
  slug: string;
  name: string;
  location: string | null;
  startDate: string;
  endDate: string;
  status: string;
  tournamentCount: number;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-800 text-gray-400 border-gray-700',
  published: 'bg-blue-900/60 text-blue-300 border-blue-800',
  running: 'bg-green-900/60 text-green-300 border-green-800 animate-pulse',
  completed: 'bg-gray-800 text-gray-500 border-gray-700',
  archived: 'bg-gray-900 text-gray-600 border-gray-800',
};

export default function OrgDashboardPage() {
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [orgName, setOrgName] = useState<string>(slug);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const org = (await res.json()) as { id: string; name: string };
        setOrgName(org.name);

        // Fetch events for this org
        return fetch(`${apiUrl}/api/v1/events?organizationId=${org.id}&status=all`, {
          credentials: 'include',
          signal: controller.signal,
        });
      })
      .then(async (res) => {
        if (!res?.ok) return;
        setEvents((await res.json()) as OrgEvent[]);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError('Failed to load events');
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [slug, apiUrl]);

  return (
    <main className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">{orgName}</h1>
          <p className="text-gray-500 text-sm mt-0.5 font-mono">{slug}</p>
        </div>
        <Link
          href={`/org/${slug}/events/new`}
          className="bg-red-700 hover:bg-red-800 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
        >
          + New event
        </Link>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          Loading events…
        </div>
      )}

      {/* Empty state */}
      {!loading && events.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-24 border-2 border-dashed border-gray-200 rounded-xl text-center">
          <p className="text-4xl mb-4">🏆</p>
          <h2 className="text-xl font-semibold mb-2">Create your first event</h2>
          <p className="text-gray-500 max-w-sm mb-6 text-sm">
            An event is the gathering — FAL 2026, Swordfish 2027. Inside it you create tournaments,
            workshops, and manage your roster.
          </p>
          <Link
            href={`/org/${slug}/events/new`}
            className="bg-red-700 hover:bg-red-800 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
          >
            New event
          </Link>
        </div>
      )}

      {/* Event list */}
      {!loading && events.length > 0 && (
        <div className="flex flex-col gap-3">
          {events.map((ev) => (
            <Link
              key={ev.id}
              href={`/org/${slug}/events/${ev.id}`}
              className="block bg-white border border-gray-200 rounded-xl px-5 py-4 hover:border-red-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{ev.name}</h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {ev.location && `${ev.location} · `}
                    {new Date(ev.startDate).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {ev.startDate !== ev.endDate &&
                      ` – ${new Date(ev.endDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`}
                  </p>
                  {ev.tournamentCount > 0 && (
                    <p className="text-xs text-gray-400 mt-1">
                      {ev.tournamentCount} tournament
                      {ev.tournamentCount !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
                <span
                  className={[
                    'text-xs font-medium px-2.5 py-0.5 rounded-full border flex-shrink-0',
                    STATUS_COLORS[ev.status] ?? STATUS_COLORS['draft']!,
                  ].join(' ')}
                >
                  {ev.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
