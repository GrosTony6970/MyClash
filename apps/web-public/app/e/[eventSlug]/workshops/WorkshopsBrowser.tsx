'use client';

/**
 * WorkshopsBrowser — client-side filtering for the public workshop catalog:
 * a fuzzy search box (matches workshop title OR any instructor name) plus the
 * day / category / level / language / weapon / instructor selects
 * (`filter-workshops.ts`), all applied live to the workshops
 * the server passed in. Cards are grouped under a day heading (by the earliest
 * session's day, in the event timezone) and show the session date + time. The
 * card itself (coloured stripe, tags, capacity badge) is the shared
 * `WorkshopCard`, also used by the personal-space workshops tab.
 */
import { useMemo, useState } from 'react';
import { formatInZone, localeToBcp47 } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { WorkshopCard, workshopDayLabel } from '@/components/workshops/WorkshopCard';
import {
  groupWorkshopsByDay,
  type WorkshopListItem,
} from '@/components/workshops/workshop-grouping';
import {
  filterOptions,
  filterWorkshops,
  NO_FILTERS,
  type FilterOption,
  type WorkshopFilters,
} from './filter-workshops';

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
  const { t } = useI18n();
  const [filters, setFilters] = useState<WorkshopFilters>(NO_FILTERS);
  const choose = (key: keyof WorkshopFilters) => (value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const selects = useFilterSelects(workshops, timezone);
  const filtered = filterWorkshops(workshops, filters, timezone);

  // A Workshop that runs on the chosen day lists that day only.
  const groups = useMemo(
    () =>
      groupWorkshopsByDay(filtered, timezone).filter((g) => !filters.day || g.key === filters.day),
    [filtered, timezone, filters.day],
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          aria-label={t('publicApp.workshops.searchPlaceholder')}
          type="search"
          value={filters.query}
          onChange={(e) => choose('query')(e.target.value)}
          placeholder={t('publicApp.workshops.searchPlaceholder')}
          className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </div>
      {selects.some((s) => s.options.length > 0) && (
        <div className="mb-6 flex flex-wrap gap-2">
          {selects.map((s) => (
            <FilterSelect
              key={s.key}
              label={s.label}
              allLabel={s.allLabel}
              options={s.options}
              value={filters[s.key]}
              onChange={choose(s.key)}
            />
          ))}
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

type SelectKey = Exclude<keyof WorkshopFilters, 'query'>;

interface SelectSpec {
  key: SelectKey;
  label: string;
  allLabel: string;
  options: FilterOption[];
}

const spec = (key: SelectKey, label: string, allLabel: string, options: FilterOption[]) => ({
  key,
  label,
  allLabel,
  options,
});
const plain = (values: string[], label = (v: string) => v): FilterOption[] =>
  values.map((value) => ({ value, label: label(value) }));

/** The drop-downs, in their order on the page; each lists only what the Workshops use. */
function useFilterSelects(workshops: WorkshopListItem[], timezone: string): SelectSpec[] {
  const { t, locale } = useI18n();
  const o = useMemo(() => filterOptions(workshops, timezone), [workshops, timezone]);
  const days = o.days.map((d) => ({
    value: d.key,
    label: formatInZone(
      d.repIso,
      timezone,
      { weekday: 'short', day: 'numeric', month: 'short' },
      localeToBcp47(locale),
    ),
  }));
  return [
    spec('day', t('publicApp.workshops.filterDay'), t('publicApp.workshops.allDays'), days),
    spec(
      'category',
      t('publicApp.workshops.filterCategory'),
      t('publicApp.workshops.allCategories'),
      plain(o.categories),
    ),
    spec(
      'level',
      t('publicApp.workshops.filterLevel'),
      t('publicApp.workshops.allLevels'),
      plain(o.levels),
    ),
    spec(
      'language',
      t('publicApp.workshops.filterLanguage'),
      t('publicApp.workshops.allLanguages'),
      plain(o.languages, (lang) => lang.toUpperCase()),
    ),
    spec(
      'weapon',
      t('publicApp.workshops.filterWeapon'),
      t('publicApp.workshops.allWeapons'),
      plain(o.weapons),
    ),
    spec(
      'instructor',
      t('publicApp.workshops.filterInstructor'),
      t('publicApp.workshops.allInstructors'),
      o.instructors,
    ),
  ];
}

/** One drop-down, drawn only when it has a choice to offer. */
function FilterSelect({
  label,
  allLabel,
  options,
  value,
  onChange,
}: Omit<SelectSpec, 'key'> & { value: string; onChange: (value: string) => void }) {
  if (options.length === 0) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={SELECT_CLS}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
