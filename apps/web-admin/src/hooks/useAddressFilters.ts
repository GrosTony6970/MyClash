'use client';

/**
 * A list's filters, kept in the address so a reload lands on the same view. The one owner
 * of that (the workshop list, the roster, a Pool's bouts).
 *
 * The page reads ITS OWN copy, never the address. A `router.replace` that changes the query
 * of this server-rendered app is a round trip: the address, and `useSearchParams`, move only
 * when it commits. A search box bound to the address went back to its old value after each
 * key, and on slow wifi two quick keys left one letter. So the address is read once, when
 * the page opens, and every change goes to the copy at once and to the address after it.
 *
 * One write holds every filter of the group, built on the address as it is NOW (the page may
 * keep a Tournament there, and its tab in the hash: written without the hash, a `hashchange`
 * sends it to another tab). A filter at its default leaves the address.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export function useAddressFilters<K extends string>(
  defaults: Readonly<Record<K, string>>,
): [Readonly<Record<K, string>>, (change: Partial<Record<K, string>>) => void] {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [values, setValues] = useState<Record<K, string>>(() => {
    const opened = { ...defaults } as Record<K, string>;
    for (const key of Object.keys(defaults) as K[]) {
      opened[key] = searchParams.get(key) ?? defaults[key];
    }
    return opened;
  });

  function update(change: Partial<Record<K, string>>) {
    const next = { ...values, ...change };
    setValues(next);
    const url = new URL(window.location.href);
    for (const key of Object.keys(defaults) as K[]) {
      if (next[key] && next[key] !== defaults[key]) url.searchParams.set(key, next[key]);
      else url.searchParams.delete(key);
    }
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
  }

  return [values, update];
}
