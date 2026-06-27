'use client';

/* eslint-disable myclash/no-literal-string -- pre-i18n public page (matches the workshop detail page). */

/**
 * WorkshopsBrowser — client-side filtering for the public workshop catalog:
 * a fuzzy search box (matches workshop title OR any instructor name) plus the
 * day / category / level / language selects, all applied live to the workshops
 * the server passed in. Cards are grouped under a day heading (by the earliest
 * session's day, in the event timezone) and show the session date + time. Each
 * card carries a left color band when the workshop has a color, matching the
 * tournament cards.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { accentClassFor, fuzzyMatch } from '@myclash/ui';
import { formatInZone, zonedDay } from '@myclash/time';

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

/** Earliest scheduled session ISO for a workshop, or null when unscheduled. */
function firstSessionStart(w: WorkshopListItem): string | null {
  const dated = w.sessions
    .map((s) => s.startsAt)
    .filter((v): v is string => Boolean(v))
    .sort();
  return dated[0] ?? null;
}

const UNSCHEDULED = '__unscheduled__';

export function WorkshopsBrowser({
  workshops,
  eventSlug,
  timezone,
}: {
  workshops: WorkshopListItem[];
  eventSlug: string;
  timezone: string;
}) {
  const [query, setQuery] = useState('');
  const [day, setDay] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');
  const [language, setLanguage] = useState('');

  // Day a workshop belongs to (its earliest session's day, in the event tz).
  const dayKeyOf = useMemo(
    () => (w: WorkshopListItem) => zonedDay(firstSessionStart(w), timezone),
    [timezone],
  );

  // Distinct days (sorted) + a representative ISO per day for labelling.
  const dayOptions = useMemo(() => {
    const repByDay = new Map<string, string>();
    for (const w of workshops) {
      const start = firstSessionStart(w);
      const key = zonedDay(start, timezone);
      if (!key || !start) continue;
      const existing = repByDay.get(key);
      if (!existing || start < existing) repByDay.set(key, start);
    }
    return [...repByDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [workshops, timezone]);

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
    if (day && (dayKeyOf(w) ?? UNSCHEDULED) !== day) return false;
    if (category && w.category !== category) return false;
    if (level && w.level !== level) return false;
    if (language && w.language !== language) return false;
    // Fuzzy match on the workshop title + every instructor name together, so
    // "fiore" or an instructor's name both surface the workshop.
    const haystack = [w.title, ...w.instructors.map((i) => i.displayName)].join(' ');
    return fuzzyMatch(query, haystack);
  });

  // Group the filtered workshops by day; scheduled days ascending, then the
  // unscheduled bucket last.
  const groups = useMemo(() => {
    const byDay = new Map<string, WorkshopListItem[]>();
    for (const w of filtered) {
      const key = dayKeyOf(w) ?? UNSCHEDULED;
      const arr = byDay.get(key) ?? [];
      arr.push(w);
      byDay.set(key, arr);
    }
    const keys = [...byDay.keys()].filter((k) => k !== UNSCHEDULED).sort();
    if (byDay.has(UNSCHEDULED)) keys.push(UNSCHEDULED);
    return keys.map((key) => ({ key, items: byDay.get(key)! }));
  }, [filtered, dayKeyOf]);

  const dayLabel = (key: string): string => {
    if (key === UNSCHEDULED) return 'Date to be announced';
    const rep = dayOptions.find(([k]) => k === key)?.[1];
    return rep
      ? formatInZone(rep, timezone, { weekday: 'long', day: 'numeric', month: 'long' })
      : key;
  };

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
      {(dayOptions.length > 0 ||
        categories.length > 0 ||
        levels.length > 0 ||
        languages.length > 0) && (
        <div className="mb-6 flex flex-wrap gap-2">
          {dayOptions.length > 0 && (
            <select
              value={day}
              onChange={(e) => setDay(e.target.value)}
              aria-label="Day"
              className={SELECT_CLS}
            >
              <option value="">All days</option>
              {dayOptions.map(([key, rep]) => (
                <option key={key} value={key}>
                  {formatInZone(rep, timezone, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                </option>
              ))}
            </select>
          )}
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
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                {dayLabel(group.key)}
              </h2>
              <div className="flex flex-col gap-4">
                {group.items.map((w) => (
                  <WorkshopCard key={w.id} w={w} eventSlug={eventSlug} timezone={timezone} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function WorkshopCard({
  w,
  eventSlug,
  timezone,
}: {
  w: WorkshopListItem;
  eventSlug: string;
  timezone: string;
}) {
  const instructorNames = w.instructors.map((i) => i.displayName);
  const totalConfirmed = w.sessions.reduce((s, sess) => s + sess.confirmedCount, 0);
  const totalCapacity = w.sessions.reduce((s, sess) => s + (sess.capacity ?? 0), 0);
  const description = w.descriptionMd ?? w.shortDescription;
  // Earliest scheduled session drives the date/time line; extra sessions are
  // flagged with "+N more".
  const datedSessions = w.sessions
    .filter((s) => s.startsAt)
    .sort((a, b) => (a.startsAt! < b.startsAt! ? -1 : 1));
  const firstSession = datedSessions[0] ?? null;
  const moreCount = datedSessions.length - 1;

  return (
    <Link
      href={`/e/${eventSlug}/w/${w.slug}`}
      className="group relative block overflow-hidden rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition-colors hover:border-red-400 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500/40"
    >
      {w.color && (
        <span
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 w-1 ${accentClassFor(w.color)}`}
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold text-slate-900">{w.title}</h3>
          {instructorNames.length > 0 && (
            <p className="mt-0.5 text-sm text-slate-500">{instructorNames.join(', ')}</p>
          )}
          {description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{description}</p>}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {w.category && (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-slate-600">
                {w.category}
              </span>
            )}
            {w.level && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                {w.level}
              </span>
            )}
            {w.durationMinutes != null && (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-slate-500">
                {w.durationMinutes} min
              </span>
            )}
            {w.language && (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-slate-500">
                {w.language.toUpperCase()}
              </span>
            )}
          </div>
          {firstSession?.startsAt && (
            <p className="mt-3 text-xs font-medium text-slate-500">
              {formatInZone(firstSession.startsAt, timezone, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {firstSession.endsAt &&
                `–${formatInZone(firstSession.endsAt, timezone, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`}
              {moreCount > 0 && <span className="text-slate-400"> · +{moreCount} more</span>}
            </p>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          {totalCapacity > 0 && capacityBadge(totalConfirmed, totalCapacity)}
          <p className="mt-1 text-xs text-slate-400">
            {w.sessions.length} session{w.sessions.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>
    </Link>
  );
}
