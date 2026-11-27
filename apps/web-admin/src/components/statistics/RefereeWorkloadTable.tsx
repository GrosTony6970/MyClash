'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { SortableHeader, fuzzyMatch, useSortableList } from '@myclash/ui';
import type { RefereeWorkloadRow } from './types';

type Translate = (key: string, values?: Record<string, string | number>) => string;

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** A time sorts as a number; a zero (no Match held) is an empty cell and sinks in both directions. */
const timeOrEmpty = (ms: number): number | null => (ms > 0 ? ms : null);

function CardCount({ count, className }: { count: number; className: string }) {
  if (count <= 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="inline-block h-2.5 w-2 rounded-[1px]" />
      {count}
    </span>
  );
}

function Cards({ cards }: { cards: RefereeWorkloadRow['cards'] }) {
  return (
    <span className="inline-flex items-center gap-2">
      <CardCount count={cards.yellow} className="text-warning" />
      <CardCount count={cards.red} className="text-danger" />
      <CardCount count={cards.black} className="text-foreground" />
      {cards.yellow + cards.red + cards.black === 0 ? <span className="text-muted">—</span> : null}
    </span>
  );
}

interface Column {
  key: string;
  labelKey: string;
  align: 'left' | 'center' | 'right';
  /** The value the column sorts on. */
  sortValue: (r: RefereeWorkloadRow) => string | number | null;
  cell: (r: RefereeWorkloadRow) => ReactNode;
  cellClass: string;
}

const COUNT = 'text-center text-muted';
const TIME = 'text-right font-mono text-muted';

const count = (
  key: string,
  labelKey: string,
  value: (r: RefereeWorkloadRow) => number,
  cellClass = COUNT,
): Column => ({ key, labelKey, align: 'center', sortValue: value, cell: value, cellClass });

const time = (key: string, labelKey: string, value: (r: RefereeWorkloadRow) => number): Column => ({
  key,
  labelKey,
  align: 'right',
  sortValue: (r) => timeOrEmpty(value(r)),
  cell: (r) => formatDuration(value(r)),
  cellClass: TIME,
});

const COLUMNS: Column[] = [
  {
    key: 'name',
    labelKey: 'organizer.eventStats.referees.colReferee',
    align: 'left',
    sortValue: (r) => r.name,
    cell: (r) => r.name,
    cellClass: 'font-medium text-foreground',
  },
  count(
    'matches',
    'organizer.eventStats.referees.colMatches',
    (r) => r.matchesReffed,
    'text-center font-semibold text-foreground',
  ),
  count('lead', 'organizer.eventStats.referees.colLead', (r) => r.roles.arbitre_declarant),
  count('assessor', 'organizer.eventStats.referees.colAssessor', (r) => r.roles.arbitre_assesseur),
  count('table', 'organizer.eventStats.referees.colTable', (r) => r.roles.arbitre_table),
  {
    key: 'cards',
    labelKey: 'organizer.eventStats.referees.colCards',
    align: 'center',
    sortValue: (r) => r.cards.yellow + r.cards.red + r.cards.black,
    cell: (r) => <Cards cards={r.cards} />,
    cellClass: 'text-center',
  },
  {
    key: 'protests',
    labelKey: 'organizer.eventStats.referees.colProtests',
    align: 'center',
    sortValue: (r) => r.protests,
    cell: (r) => r.protests || '—',
    cellClass: COUNT,
  },
  time('avgTime', 'organizer.eventStats.referees.colAvgTime', (r) => r.averageRefereeTimeMs),
  time(
    'avgLead',
    'organizer.eventStats.referees.colAvgLead',
    (r) => r.averageTimeMsByRole.arbitre_declarant,
  ),
  time(
    'avgAssessor',
    'organizer.eventStats.referees.colAvgAssessor',
    (r) => r.averageTimeMsByRole.arbitre_assesseur,
  ),
  time(
    'avgTable',
    'organizer.eventStats.referees.colAvgTable',
    (r) => r.averageTimeMsByRole.arbitre_table,
  ),
];

const SORT_VALUE = new Map(COLUMNS.map((c) => [c.key, c.sortValue]));
const sortValueOf = (r: RefereeWorkloadRow, key: string) => SORT_VALUE.get(key)?.(r) ?? null;

function NameSearch({
  query,
  setQuery,
  t,
}: {
  query: string;
  setQuery: (query: string) => void;
  t: Translate;
}) {
  const label = t('organizer.eventStats.referees.searchReferee');
  return (
    <div className="mt-4 flex items-center gap-2">
      <input
        aria-label={label}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={label}
        className="w-64 rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery('')}
          className="px-2 text-sm text-muted hover:text-foreground-secondary"
        >
          {t('actions.clear')}
        </button>
      )}
    </div>
  );
}

/**
 * Event-wide referee workload leaderboard. Every column sorts (a number opens biggest first, the
 * name A→Z; a third click returns to the API's order), and a fuzzy search narrows it by name.
 */
export function RefereeWorkloadTable({
  referees,
  t,
}: {
  referees: RefereeWorkloadRow[];
  t: Translate;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim();
    return q ? referees.filter((r) => fuzzyMatch(q, r.name)) : referees;
  }, [referees, query]);
  const { sorted, sortKey, direction, toggle } = useSortableList(filtered, sortValueOf);
  const onToggle = (key: string) => toggle(key, key === 'name' ? 'asc' : 'desc');

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
        {t('organizer.eventStats.referees.title')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('organizer.eventStats.referees.subtitle')}</p>

      {referees.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          {t('organizer.eventStats.referees.empty')}
        </p>
      ) : (
        <>
          <NameSearch query={query} setQuery={setQuery} t={t} />
          <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-background text-xs uppercase tracking-[0.14em] text-muted">
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="group px-4 py-3">
                      <SortableHeader
                        label={t(c.labelKey)}
                        columnKey={c.key}
                        currentKey={sortKey}
                        direction={direction}
                        onToggle={onToggle}
                        align={c.align}
                        ariaSortAsc={t('admin.common.sortAscLabel')}
                        ariaSortDesc={t('admin.common.sortDescLabel')}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={COLUMNS.length} className="px-4 py-6 text-center text-muted">
                      {t('organizer.eventStats.referees.noMatch')}
                    </td>
                  </tr>
                ) : (
                  sorted.map((r) => (
                    <tr key={r.personId} className="border-t border-border">
                      {COLUMNS.map((c) => (
                        <td key={c.key} className={`px-4 py-3 ${c.cellClass}`}>
                          {c.cell(r)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
