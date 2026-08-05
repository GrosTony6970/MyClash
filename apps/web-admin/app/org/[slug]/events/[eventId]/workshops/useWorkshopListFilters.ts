'use client';

/**
 * Query-string home for the workshops list header controls, so a reload or a
 * back-navigation lands the organiser on the same view.
 *
 * One hook owns all four params on purpose. `useUrlState` gives each key its
 * own writer, and each writer closes over the search params as they were when
 * it was created — so clearing every filter at once (four writers, one tick)
 * has each one delete its own key from the *same* stale base, and the last
 * `router.replace` wins with the other three keys still in the URL. Writing
 * the whole group in a single replace is the fix.
 *
 * The hash is carried through: the list/schedule tab lives there, and
 * re-writing the URL without it fires a spurious `hashchange` on every
 * keystroke.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { WorkshopFilterValue } from './filter-workshops';

const KEYS = ['q', 'category', 'level', 'venue'] as const;
type FilterParams = Record<(typeof KEYS)[number], string>;

export function useWorkshopListFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = searchParams.get('q') ?? '';
  const filter = useMemo<WorkshopFilterValue>(
    () => ({
      category: searchParams.get('category') ?? '',
      level: searchParams.get('level') ?? '',
      venue: searchParams.get('venue') ?? '',
    }),
    [searchParams],
  );

  const write = useCallback(
    (next: FilterParams) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const key of KEYS) {
        if (next[key]) params.set(key, next[key]);
        else params.delete(key);
      }
      const qs = params.toString();
      const hash = typeof window === 'undefined' ? '' : window.location.hash;
      router.replace(`${pathname}${qs ? `?${qs}` : ''}${hash}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const setQuery = useCallback((q: string) => write({ q, ...filter }), [write, filter]);
  const setFilter = useCallback(
    (next: WorkshopFilterValue) => write({ q: query, ...next }),
    [write, query],
  );
  const clear = useCallback(() => write({ q: '', category: '', level: '', venue: '' }), [write]);

  return { query, filter, setQuery, setFilter, clear };
}
