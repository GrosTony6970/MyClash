'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

/**
 * useUrlState — syncs a piece of state into a query-string param so the
 * back button and direct links preserve the user's filter/search context.
 *
 * Usage:
 *   const [q, setQ] = useUrlState('q', '');
 *   const [status, setStatus] = useUrlState('status', 'all');
 *
 * Values must be string-serializable. Empty / default values are removed
 * from the URL to keep it clean.
 */
export function useUrlState<T extends string>(
  key: string,
  defaultValue: T,
): [T, (next: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const value = useMemo<T>(() => {
    const raw = searchParams.get(key);
    return raw === null ? defaultValue : (raw as T);
  }, [searchParams, key, defaultValue]);

  const setValue = useCallback(
    (next: T) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === defaultValue || next === '' || next === null || next === undefined) {
        params.delete(key);
      } else {
        params.set(key, String(next));
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, key, defaultValue],
  );

  return [value, setValue];
}
