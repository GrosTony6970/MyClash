'use client';

/**
 * The bouts tab's filter and "Hide completed", kept in the address (quick win O29) so a
 * refresh keeps them. One writer for both. It builds on the address as it is NOW, not on
 * the render's copy: the Pools page also writes `?tournamentId` there, and the tab lives in
 * the hash (rewritten without it, a `hashchange` would send the page back to Configure).
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

const HIDE_DONE = 'done';

export function useMatchListFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const hideDone = searchParams.get('hide') === HIDE_DONE;

  const write = useCallback(
    (next: { q: string; hideDone: boolean }) => {
      const url = new URL(window.location.href);
      if (next.q) url.searchParams.set('q', next.q);
      else url.searchParams.delete('q');
      if (next.hideDone) url.searchParams.set('hide', HIDE_DONE);
      else url.searchParams.delete('hide');
      router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    },
    [router],
  );

  const setQuery = useCallback((q: string) => write({ q, hideDone }), [write, hideDone]);
  const setHideDone = useCallback(
    (hide: boolean) => write({ q: query, hideDone: hide }),
    [write, query],
  );

  return { query, hideDone, setQuery, setHideDone };
}
