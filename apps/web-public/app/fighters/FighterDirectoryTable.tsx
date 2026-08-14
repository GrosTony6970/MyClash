'use client';

import Link from 'next/link';
import {
  Avatar,
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  formatCountryName,
} from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { flagEmoji } from '@/lib/flag';
import {
  directoryHref,
  toggleSort,
  type DirectoryFilters,
  type DirectorySort,
} from './directory-filters';
import {
  toFighterRowModels,
  type DirectoryApiFighter,
  type FighterRowModel,
} from './fighter-row-model';

/**
 * The directory rows: a real `<table>` at `md`+, cards below it.
 *
 * A client component because `Avatar` calls `useState`/`useEffect` and carries
 * no `'use client'` of its own, so a Server Component importing it throws
 * outright. The page above stays a server component and does the fetching.
 *
 * Both branches map over ONE row model (`fighter-row-model.ts`). `display:none`
 * removes the inactive branch from the accessibility tree, so nothing is
 * announced twice.
 */
export function FighterDirectoryTable({
  fighters,
  filters,
}: {
  fighters: DirectoryApiFighter[];
  filters: DirectoryFilters;
}) {
  const { t, locale } = useI18n();
  const rows = toFighterRowModels(fighters);

  return (
    <>
      <div className="hidden md:block">
        <DesktopTable rows={rows} filters={filters} locale={locale} t={t} />
      </div>
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <FighterCard row={row} locale={locale} t={t} />
          </li>
        ))}
      </ul>
    </>
  );
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Sortable column header.
 *
 * `SortableHeader` from @myclash/ui is deliberately NOT used: its `onToggle`
 * drives local state and its companion `sortRows` sorts an in-memory array,
 * which on a paginated directory would reorder the 24 rows on screen and lie
 * about every other page. Sorting is server-side, so a header is a LINK — which
 * also makes a sorted view shareable and keeps it working without JavaScript.
 */
function SortLink({
  column,
  label,
  filters,
  t,
}: {
  column: DirectorySort;
  label: string;
  filters: DirectoryFilters;
  t: Translate;
}) {
  const active = filters.sort === column;
  const ariaSort = active ? (filters.dir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <th scope="col" aria-sort={ariaSort} className="px-3 py-2 text-left">
      <Link
        href={directoryHref(toggleSort(filters, column))}
        scroll={false}
        className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted transition-colors hover:text-foreground"
      >
        {label}
        <span aria-hidden="true" className={active ? 'text-accent' : 'opacity-0'}>
          {active && filters.dir === 'desc' ? '↓' : '↑'}
        </span>
        <span className="sr-only">
          {active && filters.dir === 'asc'
            ? t('publicApp.fighters.sortedAscending')
            : active
              ? t('publicApp.fighters.sortedDescending')
              : t('publicApp.fighters.sortBy', { column: label })}
        </span>
      </Link>
    </th>
  );
}

function CountryCell({ code, locale }: { code: string | null; locale: string }) {
  if (!code) return <span className="text-muted">{'—'}</span>;
  const flag = flagEmoji(code);
  return (
    <span className="inline-flex items-center gap-1.5">
      {flag && <span aria-hidden="true">{flag}</span>}
      <span>{formatCountryName(code, locale)}</span>
    </span>
  );
}

function WeaponList({ weapons }: { weapons: string[] }) {
  if (weapons.length === 0) return <span className="text-muted">{'—'}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {weapons.map((weapon) => (
        <span
          key={weapon}
          className="rounded border border-border px-1.5 py-0.5 text-xs text-foreground-secondary"
        >
          {weapon}
        </span>
      ))}
    </span>
  );
}

function BodyRow({ row, locale }: { row: FighterRowModel; locale: string }) {
  return (
    <DataTableRow>
      <DataTableCell>
        <Link
          href={row.href}
          className="inline-flex items-center gap-2 font-semibold text-foreground hover:text-accent hover:underline"
        >
          <Avatar name={row.initialsSource} src={row.photoUrl ?? undefined} size="sm" />
          <span className="min-w-0 truncate">{row.name}</span>
        </Link>
      </DataTableCell>
      <DataTableCell>
        {row.clubName === null ? (
          <span className="text-muted">{'—'}</span>
        ) : row.clubHref ? (
          <Link href={row.clubHref} className="text-foreground hover:text-accent hover:underline">
            {row.clubName}
          </Link>
        ) : (
          <span className="text-foreground">{row.clubName}</span>
        )}
      </DataTableCell>
      <DataTableCell>
        <CountryCell code={row.countryCode} locale={locale} />
      </DataTableCell>
      <DataTableCell>
        <WeaponList weapons={row.weapons} />
      </DataTableCell>
    </DataTableRow>
  );
}

/** Name, Club and Country sort; Weapons does not (it is a list, not a key). */
function HeaderRow({ filters, t }: { filters: DirectoryFilters; t: Translate }) {
  return (
    <DataTableHead>
      <tr>
        {(
          [
            ['name', 'publicApp.fighters.colName'],
            ['club', 'publicApp.fighters.colClub'],
            ['country', 'publicApp.fighters.colCountry'],
          ] as const
        ).map(([column, key]) => (
          <SortLink key={column} column={column} label={t(key)} filters={filters} t={t} />
        ))}
        <th
          scope="col"
          className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted"
        >
          {t('publicApp.fighters.colWeapons')}
        </th>
      </tr>
    </DataTableHead>
  );
}

function DesktopTable({
  rows,
  filters,
  locale,
  t,
}: {
  rows: FighterRowModel[];
  filters: DirectoryFilters;
  locale: string;
  t: Translate;
}) {
  return (
    <div className="overflow-x-auto">
      <DataTable>
        <HeaderRow filters={filters} t={t} />
        <tbody>
          {rows.map((row) => (
            <BodyRow key={row.id} row={row} locale={locale} />
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}

function FighterCard({ row, locale, t }: { row: FighterRowModel; locale: string; t: Translate }) {
  return (
    <Link
      href={row.href}
      className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 transition-colors hover:border-accent/60"
    >
      <Avatar name={row.initialsSource} src={row.photoUrl ?? undefined} size="md" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-semibold text-foreground">{row.name}</span>
        <span className="truncate text-xs text-foreground-secondary">
          {row.clubName ?? t('publicApp.fighters.noClub')}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <CountryCell code={row.countryCode} locale={locale} />
          {row.weapons.length > 0 && <span className="truncate">{row.weapons.join(' · ')}</span>}
        </span>
      </span>
    </Link>
  );
}
