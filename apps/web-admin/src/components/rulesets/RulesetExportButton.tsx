'use client';

import { useState } from 'react';
import { RowActionButton, useToast } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '../../lib/api-url';

const apiUrl = getPublicApiUrl();

/**
 * Per-row "Export" action: downloads a ruleset's portable JSON envelope from
 * `endpoint`. Shared by the scoring and penalty Manage tables — they differ
 * only in the endpoint and the download filename.
 */
export function RulesetExportButton({
  endpoint,
  filename,
}: {
  endpoint: string;
  filename: string;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function onExport() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}${endpoint}`, { credentials: 'include' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(body?.message ?? t('admin.rulesets.actionFailed'));
        return;
      }
      const data = await res.json();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <RowActionButton variant="neutral" onClick={() => void onExport()}>
      {t('admin.rulesets.portability.export')}
    </RowActionButton>
  );
}
