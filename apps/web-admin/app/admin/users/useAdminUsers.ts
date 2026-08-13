'use client';

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';
import type { UserListResponse, UsersTab } from './types';

interface State {
  users: UserListResponse['users'];
  total: number;
  truncated: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY: State = { users: [], total: 0, truncated: false, loading: true, error: null };

/**
 * One scope's page of accounts.
 *
 * Search goes to the SERVER, debounced. It used to be a client-side fuzzyMatch
 * over whatever the first request happened to return, which quietly meant
 * "search the first hundred accounts" — fine while every account was staff,
 * useless on the user tab.
 */
export function useAdminUsers(scope: UsersTab, page: number, perPage: number, search: string) {
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const [state, setState] = useState<State>(EMPTY);
  const [refreshKey, setRefreshKey] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const params = new URLSearchParams({
      scope,
      page: String(page),
      perPage: String(perPage),
    });
    if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());

    fetch(`${apiUrl}/api/v1/admin/users?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setState({ ...EMPTY, loading: false, error: t('admin.users.accessDenied') });
          return;
        }
        if (res.status === 429) throw new Error(t('common.tooManyRequests'));
        if (!res.ok) throw new Error(t('admin.users.loadError'));
        const data = (await res.json()) as UserListResponse;
        if (cancelled) return;
        setState({
          users: data.users ?? [],
          total: data.total ?? 0,
          truncated: data.truncated === true,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setState({
          ...EMPTY,
          loading: false,
          error: err instanceof Error ? err.message : t('admin.users.genericError'),
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiUrl, scope, page, perPage, debouncedSearch, refreshKey, t]);

  return { ...state, refresh };
}
