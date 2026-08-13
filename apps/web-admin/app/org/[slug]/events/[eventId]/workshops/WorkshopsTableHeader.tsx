'use client';

/**
 * Header row of the workshops list: a sort trigger per column, plus the
 * filter controls the operator drives the list with.
 *
 * `DataTableHead` renders exactly one `<tr>`, so there is no second row to
 * put filters in — each control stacks under its column label instead. The
 * sort trigger is `SortableHeader`'s own button, so a control sitting beside
 * it needs no click-propagation gymnastics.
 *
 * Returns a fragment of `<th>` cells: the page keeps ownership of the table.
 */

import type { ComponentProps } from 'react';
import { DataTableCell, SortableHeader } from '@myclash/ui';
import { NO_VENUE, type WorkshopFilterOptions, type WorkshopFilterValue } from './filter-workshops';
import { useI18n } from '@myclash/next-i18n/client';

const CONTROL_CLASS =
  'w-full rounded-lg border border-border bg-surface px-2 py-1 text-xs font-normal normal-case tracking-normal text-foreground-secondary focus:outline-none focus:ring-2 focus:ring-accent';

type SortProps = Omit<ComponentProps<typeof SortableHeader>, 'label'>;
type Translate = (key: string) => string;

interface FilterSpec {
  label: string;
  ariaLabel: string;
  allLabel: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
}

interface Props {
  sortKey: string | null;
  direction: 'asc' | 'desc' | null;
  onToggleSort: (columnKey: string) => void;
  query: string;
  onQueryChange: (next: string) => void;
  filter: WorkshopFilterValue;
  onFilterChange: (next: WorkshopFilterValue) => void;
  options: WorkshopFilterOptions;
}

export function WorkshopsTableHeader({
  sortKey,
  direction,
  onToggleSort,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  options,
}: Props) {
  const { t } = useI18n();
  const sortProps = (columnKey: string): SortProps => ({
    columnKey,
    currentKey: sortKey,
    direction,
    onToggle: onToggleSort,
    ariaSortAsc: t('admin.common.sortAscLabel'),
    ariaSortDesc: t('admin.common.sortDescLabel'),
  });
  const specs = filterSpecs(t, filter, onFilterChange, options);

  return (
    <>
      <SearchCell value={query} onChange={onQueryChange} sortProps={sortProps('name')} />
      <FilterCell spec={specs.category} sortProps={sortProps('category')} />
      <FilterCell spec={specs.level} sortProps={sortProps('level')} />
      <PlainCell
        label={t('organizer.workshopsPage.colCapacity')}
        sortProps={sortProps('capacity')}
      />
      <PlainCell
        label={t('organizer.workshopsPage.colDuration')}
        sortProps={sortProps('duration')}
      />
      <PlainCell label={t('organizer.workshopsPage.colStartEnd')} sortProps={sortProps('start')} />
      <FilterCell spec={specs.venue} sortProps={sortProps('venue')} />
      <PlainCell label={t('organizer.workshopsPage.colStatus')} sortProps={sortProps('status')} />
      <DataTableCell as="th" className="align-top">
        {t('organizer.workshopsPage.colActions')}
      </DataTableCell>
    </>
  );
}

/**
 * Category and level options are the distinct values already in the list —
 * both columns are free text, so there is no enum to enumerate. Venue adds a
 * "no venue" entry only when some workshop actually lacks one.
 */
function filterSpecs(
  t: Translate,
  filter: WorkshopFilterValue,
  onFilterChange: (next: WorkshopFilterValue) => void,
  options: WorkshopFilterOptions,
): { category: FilterSpec; level: FilterSpec; venue: FilterSpec } {
  const asOptions = (values: string[]) => values.map((v) => ({ value: v, label: v }));
  return {
    category: {
      label: t('organizer.workshopsPage.colCategory'),
      ariaLabel: t('organizer.workshopsPage.filters.filterCategory'),
      allLabel: t('organizer.workshopsPage.filters.allCategories'),
      value: filter.category,
      onChange: (category) => onFilterChange({ ...filter, category }),
      options: asOptions(options.categories),
    },
    level: {
      label: t('organizer.workshopsPage.colLevel'),
      ariaLabel: t('organizer.workshopsPage.filters.filterLevel'),
      allLabel: t('organizer.workshopsPage.filters.allLevels'),
      value: filter.level,
      onChange: (level) => onFilterChange({ ...filter, level }),
      options: asOptions(options.levels),
    },
    venue: {
      label: t('organizer.workshopsPage.colVenue'),
      ariaLabel: t('organizer.workshopsPage.filters.filterVenue'),
      allLabel: t('organizer.workshopsPage.filters.allVenues'),
      value: filter.venue,
      onChange: (venue) => onFilterChange({ ...filter, venue }),
      options: [
        ...options.venues.map((v) => ({ value: v.id, label: v.name })),
        ...(options.hasUnvenued
          ? [{ value: NO_VENUE, label: t('organizer.workshopsPage.filters.noVenue') }]
          : []),
      ],
    },
  };
}

/** Sortable label, nothing else — top-aligned so it lines up with the labels
 *  of the columns that carry a control underneath. */
function PlainCell({ label, sortProps }: { label: string; sortProps: SortProps }) {
  return (
    <DataTableCell as="th" className="whitespace-nowrap align-top">
      <SortableHeader label={label} {...sortProps} />
    </DataTableCell>
  );
}

/** Name column: fuzzy search over the workshop title and its instructors. */
function SearchCell({
  value,
  onChange,
  sortProps,
}: {
  value: string;
  onChange: (next: string) => void;
  sortProps: SortProps;
}) {
  const { t } = useI18n();
  return (
    <DataTableCell as="th" className="min-w-[16rem]">
      <div className="flex flex-col gap-1.5">
        <SortableHeader label={t('organizer.workshopsPage.colName')} {...sortProps} />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('organizer.workshopsPage.filters.searchPlaceholder')}
          aria-label={t('organizer.workshopsPage.filters.searchAria')}
          className={CONTROL_CLASS}
        />
      </div>
    </DataTableCell>
  );
}

/** Sortable label with a "value or all" dropdown stacked underneath. */
function FilterCell({ spec, sortProps }: { spec: FilterSpec; sortProps: SortProps }) {
  return (
    <DataTableCell as="th" className="min-w-[9rem]">
      <div className="flex flex-col gap-1.5">
        <SortableHeader label={spec.label} {...sortProps} />
        <select
          value={spec.value}
          onChange={(e) => spec.onChange(e.target.value)}
          aria-label={spec.ariaLabel}
          className={`${CONTROL_CLASS} cursor-pointer`}
        >
          <option value="">{spec.allLabel}</option>
          {spec.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </DataTableCell>
  );
}
