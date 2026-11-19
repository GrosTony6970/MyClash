'use client';

import { useState } from 'react';
import { ConfirmDialog, useToast } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { diskPruneOutcome, type DiskPruneResult } from './disk-prune';

/**
 * "Free disk space" on the Host card (ruling 897): the build cache and the dangling images, after
 * a confirm that says the next deploy rebuilds from the start. `onDone` re-reads the card.
 */
export function DiskPruneButton({ onDone }: { onDone: () => void }) {
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pruning, setPruning] = useState(false);

  async function confirmPrune() {
    setPruning(true);
    try {
      const r = await apiRequest<DiskPruneResult>(apiUrl, '/api/v1/admin/system/host-info/prune', {
        method: 'POST',
      });
      const outcome = diskPruneOutcome(r, t);
      if (outcome?.tone === 'success') {
        toast.success(outcome.message);
        setConfirmOpen(false);
        onDone();
      } else if (outcome) {
        toast.error(outcome.message);
      }
    } finally {
      setPruning(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={pruning}
        className="rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
      >
        {t('admin.systemVersions.host.prune.button')}
      </button>
      <ConfirmDialog
        cancelLabel={t('actions.cancel')}
        open={confirmOpen}
        title={t('admin.systemVersions.host.prune.confirmTitle')}
        description={t('admin.systemVersions.host.prune.confirmDescription')}
        confirmLabel={t('admin.systemVersions.host.prune.confirm')}
        danger
        busy={pruning}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void confirmPrune()}
      />
    </>
  );
}
