'use client';

/**
 * Query-string home for the workshops list header controls, so a reload or a
 * back-navigation lands the organiser on the same view.
 *
 * One group, one write: clearing every filter at once is one address, not four
 * writers each deleting its own key from the same stale base. `useAddressFilters`
 * owns how (the page reads its own copy; the address is written after).
 */

import { useMemo } from 'react';
import { useAddressFilters } from '@/hooks/useAddressFilters';
import type { WorkshopFilterValue } from './filter-workshops';

const DEFAULTS = { q: '', category: '', level: '', venue: '' };

export function useWorkshopListFilters() {
  const [values, update] = useAddressFilters(DEFAULTS);
  const filter = useMemo<WorkshopFilterValue>(
    () => ({ category: values.category, level: values.level, venue: values.venue }),
    [values],
  );
  return {
    query: values.q,
    filter,
    setQuery: (q: string) => update({ q }),
    setFilter: (next: WorkshopFilterValue) => update(next),
    clear: () => update(DEFAULTS),
  };
}
