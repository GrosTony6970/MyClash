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
 */
export function useSortableList<T>(rows: readonly T[], getValue: (row: T, key: string) => unknown) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [direction, setDirection] = useState<'asc' | 'desc' | null>(null);

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
