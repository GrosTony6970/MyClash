import { useMemo, useState } from 'react';
import { nextSortState, sortRows } from '../components/SortableHeader';

/**
 * Stateful companion to `<SortableHeader>`. Holds the active `(key, direction)`
 * pair, exposes a `toggle(columnKey)` cycler, and returns the sorted view of
 * the input rows.
 *
 * `getValue(row, key)` is how the hook reads the value for a given column —
 * the consumer decides what shape to return; the hook handles null-coalescing
 * and locale-aware comparison.
 *
 * `initial` opens the list already sorted. It seeds the state and nothing else:
 * the cycle stays `nextSortState`, so the first click on the seeded column
 * *advances* it (a list opened on `desc` goes to unsorted) rather than
 * restarting at `asc`. A list that opens unsorted omits it.
 *
 * It exists because a list that opens newest-first is ordinary, and without it
 * the organiser's Events list re-implemented this whole hook inline to get one.
 */
export function useSortableList<T>(
  rows: readonly T[],
  getValue: (row: T, key: string) => unknown,
  initial?: { key: string | null; direction: 'asc' | 'desc' | null },
) {
  const [sortKey, setSortKey] = useState<string | null>(initial?.key ?? null);
  const [direction, setDirection] = useState<'asc' | 'desc' | null>(initial?.direction ?? null);

  const sorted = useMemo(
    () => sortRows(rows, sortKey, direction, getValue),
    [rows, sortKey, direction, getValue],
  );

  function toggle(columnKey: string) {
    const next = nextSortState(sortKey, direction, columnKey);
    setSortKey(next.key);
    setDirection(next.direction);
  }

  return { sorted, sortKey, direction, toggle };
}
