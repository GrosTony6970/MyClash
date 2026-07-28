'use client';

import { useEffect, useState } from 'react';
import { getPublicApiUrl } from '../lib/api-url';

const apiUrl = getPublicApiUrl();

const DEBOUNCE_MS = 300;
const PER_PAGE = 20;

export const ACCOUNT_SEARCH_MIN_LENGTH = 2;

export interface AccountOrgMembership {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface AccountSearchResult {
  id: string;
  email?: string;
  display_name?: string | null;
  organizations?: AccountOrgMembership[];
}

export interface AccountSearchState {
  accounts: AccountSearchResult[];
  loading: boolean;
}

/**
 * Debounced platform-account search for the league admin pickers
 * (GET /api/v1/admin/users?scope=all&q=…, super-admin only).
 *
 * `scope=all` on purpose: the default `staff` scope is super-admins plus
 * `organization_members`, which excludes exactly the accounts the individual
 * league-admin axis exists for — a coordinator holding only a public login.
 * Searching server-side also means results are the API's ranked matches over
 * every account, not a client-side filter over a truncated preload.
 *
 * Queries shorter than ACCOUNT_SEARCH_MIN_LENGTH resolve to an empty list with
 * no request. Results and the loading flag are derived from the term the last
 * response was for, so the effect never sets state synchronously in its body
 * (`react-hooks/set-state-in-effect`); a failed fetch resolves to an empty
 * list for that term rather than leaving the picker spinning.
 */
export function useAccountSearch(query: string): AccountSearchState {
  const term = query.trim();
  const [loaded, setLoaded] = useState<{ term: string; accounts: AccountSearchResult[] }>({
    term: '',
    accounts: [],
  });

  useEffect(() => {
    const search = query.trim();
    if (search.length < ACCOUNT_SEARCH_MIN_LENGTH) return;
    if (loaded.term === search) return;

    let cancelled = false;

    async function load() {
      const params = new URLSearchParams({
        scope: 'all',
        perPage: String(PER_PAGE),
        q: search,
      });
      let users: AccountSearchResult[] = [];
      try {
        const res = await fetch(`${apiUrl}/api/v1/admin/users?${params}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = (await res.json()) as { users?: AccountSearchResult[] };
          users = data.users ?? [];
        }
      } catch {
        // Best-effort — a transient failure shows as "no match".
      }
      if (!cancelled) setLoaded({ term: search, accounts: users });
    }

    const timer = setTimeout(() => void load(), DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, loaded.term]);

  const searchable = term.length >= ACCOUNT_SEARCH_MIN_LENGTH;
  return {
    accounts: searchable && loaded.term === term ? loaded.accounts : [],
    loading: searchable && loaded.term !== term,
  };
}
