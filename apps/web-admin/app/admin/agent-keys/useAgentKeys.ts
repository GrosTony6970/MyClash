'use client';

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

export interface AgentKeyRow {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export const AGENT_KEYS_PATH = '/api/v1/admin/agent-keys';

interface State {
  keys: AgentKeyRow[];
  loading: boolean;
  error: string | null;
}

/** The ops agent's keys, newest first, and a `refresh` that reads them again. */
export function useAgentKeys() {
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const [state, setState] = useState<State>({ keys: [], loading: true, error: null });
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void apiRequest<AgentKeyRow[]>(apiUrl, AGENT_KEYS_PATH, { signal: controller.signal }).then(
      (r) => {
        if (cancelled) return;
        if (r.ok) {
          setState({ keys: r.data ?? [], loading: false, error: null });
          return;
        }
        // A dead session and a missing platform role read the same here, as on admin/users.
        if (r.kind === 'unauthenticated') {
          setState({ keys: [], loading: false, error: t('admin.agentKeys.accessDenied') });
          return;
        }
        const message = failureMessage(r, t, t('admin.agentKeys.loadError'));
        if (message) setState({ keys: [], loading: false, error: message });
      },
    );
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiUrl, refreshKey, t]);

  return { ...state, refresh };
}
