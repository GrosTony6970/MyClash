'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ConfirmDialog,
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  rowActionClasses,
  useToast,
} from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { localeToBcp47 } from '@myclash/time';
import { getPublicApiUrl } from '@/lib/api-url';

interface AgentKeyRow {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface State {
  keys: AgentKeyRow[];
  loading: boolean;
  error: string | null;
}

const LIST = '/api/v1/admin/agent-keys';

/** The keys, newest first, with a Revoke on the live one. Ids stay out of sight. */
export function AgentKeysPanel() {
  const apiUrl = getPublicApiUrl();
  const { t, locale } = useI18n();
  const toast = useToast();
  const [state, setState] = useState<State>({ keys: [], loading: true, error: null });
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, setPending] = useState<AgentKeyRow | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void apiRequest<AgentKeyRow[]>(apiUrl, LIST, { signal: controller.signal }).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setState({ keys: r.data ?? [], loading: false, error: null });
        return;
      }
      if (r.kind === 'unauthenticated') {
        setState({ keys: [], loading: false, error: t('admin.agentKeys.accessDenied') });
        return;
      }
      const message = failureMessage(r, t, t('admin.agentKeys.loadError'));
      if (message) setState({ keys: [], loading: false, error: message });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiUrl, refreshKey, t]);

  const when = (value: string | null) =>
    value ? new Date(value).toLocaleString(localeToBcp47(locale)) : t('admin.agentKeys.never');

  async function revoke(key: AgentKeyRow) {
    setBusy(true);
    try {
      const r = await apiRequest(apiUrl, `${LIST}/${key.id}/revoke`, { method: 'POST' });
      if (r.ok) {
        toast.success(t('admin.agentKeys.revoked'));
        setPending(null);
        refresh();
      } else {
        const message = failureMessage(r, t, t('admin.agentKeys.revokeFailed'));
        if (message) toast.error(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="max-w-3xl text-sm text-foreground-secondary">{t('admin.agentKeys.howTo')}</p>

      {state.error && (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      {state.loading ? (
        <p className="text-sm text-muted">{t('admin.agentKeys.loading')}</p>
      ) : state.keys.length === 0 && !state.error ? (
        <p className="text-sm text-muted">{t('admin.agentKeys.notConfigured')}</p>
      ) : (
        <DataTable>
          <DataTableHead>
            <DataTableCell as="th">{t('admin.agentKeys.table.label')}</DataTableCell>
            <DataTableCell as="th">{t('admin.agentKeys.table.created')}</DataTableCell>
            <DataTableCell as="th">{t('admin.agentKeys.table.lastUsed')}</DataTableCell>
            <DataTableCell as="th">{t('admin.agentKeys.table.status')}</DataTableCell>
            <DataTableCell as="th">{t('admin.agentKeys.table.actions')}</DataTableCell>
          </DataTableHead>
          <tbody>
            {state.keys.map((key) => (
              <DataTableRow key={key.id}>
                <DataTableCell className="font-medium text-foreground">{key.label}</DataTableCell>
                <DataTableCell className="text-foreground-secondary">
                  {when(key.createdAt)}
                </DataTableCell>
                <DataTableCell className="text-foreground-secondary">
                  {when(key.lastUsedAt)}
                </DataTableCell>
                <DataTableCell>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                      key.revokedAt ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'
                    }`}
                  >
                    {key.revokedAt
                      ? t('admin.agentKeys.status.revoked')
                      : t('admin.agentKeys.status.live')}
                  </span>
                </DataTableCell>
                <DataTableCell>
                  {!key.revokedAt && (
                    <button
                      type="button"
                      className={rowActionClasses('danger')}
                      onClick={() => setPending(key)}
                    >
                      {t('admin.agentKeys.revoke')}
                    </button>
                  )}
                </DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={t('admin.agentKeys.confirmTitle')}
        description={t('admin.agentKeys.confirmBody')}
        confirmLabel={t('admin.agentKeys.confirm')}
        cancelLabel={t('actions.cancel')}
        danger
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) void revoke(pending);
        }}
      />
    </>
  );
}
