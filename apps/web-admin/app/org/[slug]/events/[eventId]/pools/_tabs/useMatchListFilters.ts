'use client';

/**
 * The bouts tab's filter and "Hide completed", kept in the address (quick win O29) so a
 * refresh keeps them, beside the Pools page's Tournament and its tab in the hash.
 */

import { useAddressFilters } from '@/hooks/useAddressFilters';

const HIDE_DONE = 'done';
const DEFAULTS = { q: '', hide: '' };

export function useMatchListFilters() {
  const [values, update] = useAddressFilters(DEFAULTS);
  return {
    query: values.q,
    hideDone: values.hide === HIDE_DONE,
    setQuery: (q: string) => update({ q }),
    setHideDone: (hide: boolean) => update({ hide: hide ? HIDE_DONE : '' }),
  };
}
