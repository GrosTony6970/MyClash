'use client';

import { useCallback, useMemo, useState } from 'react';

/**
 * useSelection — multi-row selection state for list pages.
 *
 * Returns the selected ids as a Set plus toggle / toggleAll / clear / has /
 * count helpers. Used by <BulkActionBar> consumers.
 */
export interface UseSelectionResult {
  selected: Set<string>;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  toggleAll: (ids: readonly string[]) => void;
  clear: () => void;
  count: number;
}

export function useSelection(): UseSelectionResult {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback((ids: readonly string[]) => {
    setSelected((prev) => {
      // If every id is already selected, clear; otherwise select all.
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(ids);
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const has = useCallback((id: string) => selected.has(id), [selected]);

  return useMemo<UseSelectionResult>(
    () => ({ selected, has, toggle, toggleAll, clear, count: selected.size }),
    [selected, has, toggle, toggleAll, clear],
  );
}
