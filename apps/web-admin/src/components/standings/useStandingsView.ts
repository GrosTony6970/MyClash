'use client';

import { useCallback, useMemo, useState } from 'react';
import { fuzzyMatch, sortRows } from '@myclash/ui';

/**
 * Minimal row shape the standings filter/sort needs. Both the pools-tab row
 * (which additionally carries `status`) and the statistics row satisfy it
 * structurally.
 */
export interface StandingsRowLike {
  rank: number;
  displayName: string;
  club: { name: string; abbreviation: string | null } | null;
  status?: string;
  stats: Record<string, number | string>;
}

type SortState = { key: string | null; direction: 'asc' | 'desc' | null };

/**
 * Client-side filter + sort for a standings table.
 *
 * - `query` fuzzy-filters rows by fighter name / club (diacritic-insensitive,
 *   via `fuzzyMatch`).
 * - `toggle(columnKey, sortDesc)` cycles the sort. Unlike the generic
 *   `useSortableList` (always asc-first), the first click honours the column's
 *   natural direction: `sortDesc` columns (higher-is-better, e.g. score/wins)
 *   open **descending** so the strongest fighter leads. Cycle: preferred →
 *   opposite → off (back to the API's canonical rank order).
 * - `isDefaultOrder` is true only when neither a sort nor a filter is active —
 *   callers use it to decide whether rank-position-based chrome (e.g. the
 *   bracket qualification cut line) is still meaningful.
 */
export function useStandingsView<T extends StandingsRowLike>(rows: readonly T[]) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>({ key: null, direction: null });

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return rows;
    return rows.filter((r) =>
      fuzzyMatch(q, [r.displayName, r.club?.name, r.club?.abbreviation].filter(Boolean).join(' ')),
    );
  }, [rows, query]);

  const getValue = useCallback((row: T, key: string): unknown => {
    if (key === 'rank') return row.rank;
    if (key === 'fighter') return row.displayName;
    if (key === 'status') return row.status;
    return row.stats[key];
  }, []);

  const view = useMemo(
    () => sortRows(filtered, sort.key, sort.direction, getValue),
    [filtered, sort.key, sort.direction, getValue],
  );

  const toggle = useCallback((columnKey: string, sortDesc?: boolean) => {
    const preferred: 'asc' | 'desc' = sortDesc ? 'desc' : 'asc';
    setSort((prev) => {
      if (prev.key !== columnKey) return { key: columnKey, direction: preferred };
      if (prev.direction === preferred) {
        return { key: columnKey, direction: preferred === 'asc' ? 'desc' : 'asc' };
      }
      return { key: null, direction: null };
    });
  }, []);

  return {
    query,
    setQuery,
    view,
    sortKey: sort.key,
    direction: sort.direction,
    toggle,
    isDefaultOrder: sort.key === null && query.trim() === '',
  };
}
