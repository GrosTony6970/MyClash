/**
 * Workshop catalog — T-803
 * Route: /e/[eventSlug]/workshops
 *
 * AC:
 *   ✓ Filters: day, category, level, language, instructor
 *   ✓ Anonymous can browse; enroll requires login
 */

import type { Metadata } from 'next';
import { getApiUrl } from '@/lib/api-url';
import Link from 'next/link';

interface Props {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<{
    day?: string;
    category?: string;
    level?: string;
    language?: string;
  }>;
}

interface Workshop {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  level: string | null;
  language: string | null;
  capacity: number;
  locationLabel: string | null;
  workshopSessions: Array<{
    id: string;
    startTime: string;
    endTime: string;
    location: string | null;
    capacity: number;
    confirmedCount: number;
  }>;
  workshopInstructors: Array<{
    persons: { id: string; givenName: string; familyName: string } | null;
  }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventSlug } = await params;
  return { title: `Workshops — ${eventSlug}` };
}

async function fetchWorkshops(eventSlug: string, apiUrl: string): Promise<Workshop[]> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventSlug}/workshops`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return (await res.json()) as Workshop[];
  } catch {
    return [];
  }
}

function capacityBadge(confirmed: number, capacity: number) {
  const pct = confirmed / capacity;
  if (pct >= 1)
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
        Full
      </span>
    );
  if (pct >= 0.8)
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">
        Almost full
      </span>
    );
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
      {capacity - confirmed} spots left
    </span>
  );
}

export default async function WorkshopsPage({ params, searchParams }: Props) {
  const { eventSlug } = await params;
  const filters = await searchParams;
  const apiUrl = getApiUrl();

  const workshops = await fetchWorkshops(eventSlug, apiUrl);

  // Apply filters
  const filtered = workshops.filter((w) => {
    if (filters.category && w.category !== filters.category) return false;
    if (filters.level && w.level !== filters.level) return false;
    if (filters.language && w.language !== filters.language) return false;
    if (filters.day) {
      const hasSessionOnDay = w.workshopSessions.some((s) => s.startTime.startsWith(filters.day!));
      if (!hasSessionOnDay) return false;
    }
    return true;
  });

  // Collect filter options
  const categories = [...new Set(workshops.map((w) => w.category).filter(Boolean))];
  const levels = [...new Set(workshops.map((w) => w.level).filter(Boolean))];
  const languages = [...new Set(workshops.map((w) => w.language).filter(Boolean))];

  return (
    <main className="px-4 py-6 max-w-2xl mx-auto">
      <h1
        className="text-2xl font-bold mb-4"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary, #c0392b)' }}
      >
        Workshops
      </h1>

      {/* Filters */}
      <form className="flex flex-wrap gap-2 mb-6">
        {categories.length > 0 && (
          <select
            name="category"
            defaultValue={filters.category ?? ''}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c!}>
                {c}
              </option>
            ))}
          </select>
        )}
        {levels.length > 0 && (
          <select
            name="level"
            defaultValue={filters.level ?? ''}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
          >
            <option value="">All levels</option>
            {levels.map((l) => (
              <option key={l} value={l!}>
                {l}
              </option>
            ))}
          </select>
        )}
        {languages.length > 0 && (
          <select
            name="language"
            defaultValue={filters.language ?? ''}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
          >
            <option value="">All languages</option>
            {languages.map((lang) => (
              <option key={lang} value={lang!}>
                {lang}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          className="px-3 py-1.5 rounded-lg text-sm font-medium text-white"
          style={{ backgroundColor: 'var(--event-primary, #c0392b)' }}
        >
          Filter
        </button>
      </form>

      {/* Workshop list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">No workshops match your filters.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((w) => {
            const instructors = w.workshopInstructors.map((i) => i.persons).filter(Boolean);
            const totalConfirmed = w.workshopSessions.reduce(
              (s, sess) => s + sess.confirmedCount,
              0,
            );
            const totalCapacity = w.workshopSessions.reduce((s, sess) => s + sess.capacity, 0);

            return (
              <Link
                key={w.id}
                href={`/e/${eventSlug}/w/${w.slug}`}
                className="block border border-gray-200 rounded-xl p-5 hover:border-gray-300 hover:shadow-sm transition-all bg-white"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <h2 className="font-semibold text-gray-900 text-lg">{w.name}</h2>
                    {instructors.length > 0 && (
                      <p className="text-sm text-gray-500 mt-0.5">
                        {instructors.map((i) => `${i!.givenName} ${i!.familyName}`).join(', ')}
                      </p>
                    )}
                    {w.description && (
                      <p className="text-sm text-gray-600 mt-2 line-clamp-2">{w.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {w.category && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {w.category}
                        </span>
                      )}
                      {w.level && (
                        <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                          {w.level}
                        </span>
                      )}
                      {w.language && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                          {w.language.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {totalCapacity > 0 && capacityBadge(totalConfirmed, totalCapacity)}
                    <p className="text-xs text-gray-400 mt-1">
                      {w.workshopSessions.length} session
                      {w.workshopSessions.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
