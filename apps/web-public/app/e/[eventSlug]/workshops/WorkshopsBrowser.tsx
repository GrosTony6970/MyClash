'use client';

/**
 * WorkshopsBrowser — client-side filtering for the public workshop catalog:
 * a fuzzy search box (matches workshop title OR any instructor name) plus the
 * day / category / level / language selects, all applied live to the workshops
 * the server passed in. Cards are grouped under a day heading (by the earliest
 * session's day, in the event timezone) and show the session date + time. The
 * card itself (coloured stripe, tags, capacity badge) is the shared
 * `WorkshopCard`, also used by the personal-space workshops tab.
 */
import { useMemo, useState } from 'react';
import { fuzzyMatch } from '@myclash/ui';
import { zonedDay, formatInZone, localeToBcp47 } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { WorkshopCard, workshopDayLabel } from '@/components/workshops/WorkshopCard';
import {
  firstSessionStart,
  groupWorkshopsByDay,
  WORKSHOP_UNSCHEDULED,
  type WorkshopListItem,
} from '@/components/workshops/workshop-grouping';

export type { WorkshopListItem };

const SELECT_CLS =
  'border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40';

export function WorkshopsBrowser({
  workshops,
  eventSlug,
  timezone,
}: {
  workshops: WorkshopListItem[];
  eventSlug: string;
  timezone: string;
}) {
  const { t, locale } = useI18n();
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
    if (day && (dayKeyOf(w) ?? WORKSHOP_UNSCHEDULED) !== day) return false;
    if (category && w.category !== category) return false;
    if (level && w.level !== level) return false;
    if (language && w.language !== language) return false;
    // Fuzzy match on the workshop title + every instructor name together, so
    // "fiore" or an instructor's name both surface the workshop.
    const haystack = [w.title, ...w.instructors.map((i) => i.displayName)].join(' ');
    return fuzzyMatch(query, haystack);
  });

  const groups = useMemo(() => groupWorkshopsByDay(filtered, timezone), [filtered, timezone]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('publicApp.workshops.searchPlaceholder')}
          className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
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
              aria-label={t('publicApp.workshops.filterDay')}
              className={SELECT_CLS}
            >
              <option value="">{t('publicApp.workshops.allDays')}</option>
              {dayOptions.map(([key, rep]) => (
                <option key={key} value={key}>
                  {formatInZone(
                    rep,
                    timezone,
                    {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    },
                    localeToBcp47(locale),
                  )}
                </option>
              ))}
            </select>
          )}
          {categories.length > 0 && (
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label={t('publicApp.workshops.filterCategory')}
              className={SELECT_CLS}
            >
              <option value="">{t('publicApp.workshops.allCategories')}</option>
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
              aria-label={t('publicApp.workshops.filterLevel')}
              className={SELECT_CLS}
            >
              <option value="">{t('publicApp.workshops.allLevels')}</option>
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
              aria-label={t('publicApp.workshops.filterLanguage')}
              className={SELECT_CLS}
            >
              <option value="">{t('publicApp.workshops.allLanguages')}</option>
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
          <p className="text-sm text-muted">{t('publicApp.workshops.emptySearch')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
                {workshopDayLabel(group, timezone, t)}
              </h2>
              <div className="flex flex-col gap-4">
                {group.items.map((w) => (
                  <WorkshopCard
                    key={w.id}
                    workshop={w}
                    timezone={timezone}
                    href={`/e/${eventSlug}/w/${w.slug}`}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
