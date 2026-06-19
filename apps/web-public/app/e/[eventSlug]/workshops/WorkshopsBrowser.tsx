'use client';

/* eslint-disable myclash/no-literal-string -- pre-i18n public page (matches the workshop detail page). */

/**
 * WorkshopsBrowser — client-side filtering for the public workshop catalog:
 * a fuzzy search box (matches workshop title OR any instructor name) plus the
 * category / level / language selects, all applied live to the workshops the
 * server passed in. Each card carries a left color band when the workshop has
 * a color, matching the tournament cards.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { accentClassFor, fuzzyMatch } from '@myclash/ui';

export interface WorkshopListItem {
  id: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  descriptionMd: string | null;
  category: string | null;
  level: string | null;
  language: string | null;
  color: string | null;
  capacity: number | null;
  durationMinutes: number | null;
  sessions: Array<{
    id: string;
    startsAt: string | null;
    endsAt: string | null;
    locationLabel: string | null;
    capacity: number | null;
    confirmedCount: number;
  }>;
  instructors: Array<{ globalPersonId: string | null; displayName: string }>;
}

function capacityBadge(confirmed: number, capacity: number) {
  const pct = confirmed / capacity;
  if (pct >= 1)
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        Full
      </span>
    );
  if (pct >= 0.8)
    return (
      <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
        Almost full
      </span>
    );
  return (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
      {capacity - confirmed} spots left
    </span>
  );
}

const SELECT_CLS =
  'border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/40';

export function WorkshopsBrowser({
  workshops,
  eventSlug,
}: {
  workshops: WorkshopListItem[];
  eventSlug: string;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');
  const [language, setLanguage] = useState('');

  const categories = useMemo(
    () => [...new Set(workshops.map((w) => w.category).filter((v): v is string => Boolean(v)))],
    [workshops],
  );
  const levels = useMemo(
    () => [...new Set(workshops.map((w) => w.level).filter((v): v is string => Boolean(v)))],
    [workshops],
  );
  const languages = useMemo(
    () => [...new Set(workshops.map((w) => w.language).filter((v): v is string => Boolean(v)))],
    [workshops],
  );

  const filtered = workshops.filter((w) => {
    if (category && w.category !== category) return false;
    if (level && w.level !== level) return false;
    if (language && w.language !== language) return false;
    // Fuzzy match on the workshop title + every instructor name together, so
    // "fiore" or an instructor's name both surface the workshop.
    const haystack = [w.title, ...w.instructors.map((i) => i.displayName)].join(' ');
    return fuzzyMatch(query, haystack);
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by workshop or instructor…"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/40"
        />
      </div>
      {(categories.length > 0 || levels.length > 0 || languages.length > 0) && (
        <div className="mb-6 flex flex-wrap gap-2">
          {categories.length > 0 && (
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Category"
              className={SELECT_CLS}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          {levels.length > 0 && (
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              aria-label="Level"
              className={SELECT_CLS}
            >
              <option value="">All levels</option>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          )}
          {languages.length > 0 && (
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              aria-label="Language"
              className={SELECT_CLS}
            >
              <option value="">All languages</option>
              {languages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang.toUpperCase()}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-gray-400">No workshops match your search.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((w) => {
            const instructorNames = w.instructors.map((i) => i.displayName);
            const totalConfirmed = w.sessions.reduce((s, sess) => s + sess.confirmedCount, 0);
            const totalCapacity = w.sessions.reduce((s, sess) => s + (sess.capacity ?? 0), 0);
            const description = w.descriptionMd ?? w.shortDescription;
            return (
              <Link
                key={w.id}
                href={`/e/${eventSlug}/w/${w.slug}`}
                className="relative block overflow-hidden rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-gray-300 hover:shadow-sm"
              >
                {w.color && (
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-0 left-0 w-1 ${accentClassFor(w.color)}`}
                  />
                )}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold text-gray-900">{w.title}</h2>
                    {instructorNames.length > 0 && (
                      <p className="mt-0.5 text-sm text-gray-500">{instructorNames.join(', ')}</p>
                    )}
                    {description && (
                      <p className="mt-2 line-clamp-2 text-sm text-gray-600">{description}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {w.category && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                          {w.category}
                        </span>
                      )}
                      {w.level && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                          {w.level}
                        </span>
                      )}
                      {w.language && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          {w.language.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {totalCapacity > 0 && capacityBadge(totalConfirmed, totalCapacity)}
                    <p className="mt-1 text-xs text-gray-400">
                      {w.sessions.length} session{w.sessions.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
