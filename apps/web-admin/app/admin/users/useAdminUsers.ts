'use client';

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
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

    void apiRequest<UserListResponse>(apiUrl, `/api/v1/admin/users?${params}`, {
      signal: controller.signal,
    }).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setState({
          users: r.data.users ?? [],
          total: r.data.total ?? 0,
          truncated: r.data.truncated === true,
          loading: false,
          error: null,
        });
        return;
      }
      // A dead session and a missing platform role read the same to the guard,
      // and the same to the operator here — the call admin/backups makes.
      if (r.kind === 'unauthenticated') {
        setState({ ...EMPTY, loading: false, error: t('admin.users.accessDenied') });
        return;
      }
      // No message is the unmount, or the search that replaced this read. The
      // 429 sentence used to be picked here; `failureMessage` owns it now.
      const message = failureMessage(r, t, t('admin.users.loadError'));
      if (message) setState({ ...EMPTY, loading: false, error: message });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiUrl, scope, page, perPage, debouncedSearch, refreshKey, t]);

  return { ...state, refresh };
}
