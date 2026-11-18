'use client';

import { useState } from 'react';
import { ConfirmDialog, useToast } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { AgentKeysTable } from './AgentKeysTable';
import { AGENT_KEYS_PATH, useAgentKeys, type AgentKeyRow } from './useAgentKeys';

/** What the read gave: the loading line, the empty line, or the table. */
function AgentKeysBody({
  keys,
  loading,
  error,
  onRevoke,
}: {
  keys: AgentKeyRow[];
  loading: boolean;
  error: string | null;
  onRevoke: (key: AgentKeyRow) => void;
}) {
  const { t } = useI18n();
  if (loading) return <p className="text-sm text-muted">{t('admin.agentKeys.loading')}</p>;
  if (keys.length === 0 && !error) {
    return <p className="text-sm text-muted">{t('admin.agentKeys.notConfigured')}</p>;
  }
  return <AgentKeysTable keys={keys} onRevoke={onRevoke} />;
}

/** The keys, how to replace or end them, and the revoke behind a confirmation. */
export function AgentKeysPanel() {
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const toast = useToast();
  const { keys, loading, error, refresh } = useAgentKeys();
  const [pending, setPending] = useState<AgentKeyRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function revoke(key: AgentKeyRow) {
    setBusy(true);
    try {
      const r = await apiRequest(apiUrl, `${AGENT_KEYS_PATH}/${key.id}/revoke`, { method: 'POST' });
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
      {error && (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <AgentKeysBody keys={keys} loading={loading} error={error} onRevoke={setPending} />
      <ConfirmDialog
        open={pending !== null}
        title={t('admin.agentKeys.confirmTitle')}
        description={t('admin.agentKeys.confirmBody')}
        confirmLabel={t('admin.agentKeys.confirm')}
        cancelLabel={t('actions.cancel')}
        danger
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && void revoke(pending)}
      />
    </>
  );
}
