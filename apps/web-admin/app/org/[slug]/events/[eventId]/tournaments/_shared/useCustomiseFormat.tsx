'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useState } from 'react';
import { useConfirm, useToast } from '@myclash/ui';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

/**
 * "Customise this format": forks the tournament's built-in ruleset into a
 * private, org-owned copy and re-points the tournament to it (score-preserving,
 * see EventsService.forkCodedRulesetForTournament). After it succeeds the
 * tournament no longer points at the locked built-in, so the caller re-loads to
 * pick up the now-editable controls.
 *
 * The confirm is deliberate rather than silent: forking changes the ruleset the
 * event PUBLICLY declares (fighters see the org's copy, not the federal format).
 */
export function useCustomiseFormat(tournamentId: string, onDone: () => void) {
  const { t } = useI18n();

  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [customising, setCustomising] = useState(false);

  async function customise() {
    const ok = await confirm({
      title: t('admin.orgTournaments.customiseFormatTitle'),
      description: t('admin.orgTournaments.customiseFormatConfirm'),
      confirmLabel: t('admin.orgTournaments.customiseFormat'),
    });
    if (!ok) return;
    setCustomising(true);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/tournaments/${tournamentId}/customise-format`, {
        method: 'POST',
      });
      if (!r.ok) {
        // Forking a coded format is refused by what already pins the original.
        const message = failureMessage(r, t, t('admin.common.saveFailed'));
        if (message) toast.error(message);
        return;
      }
      toast.success(t('admin.orgTournaments.customiseFormatSuccess'));
      onDone();
    } finally {
      setCustomising(false);
    }
  }

  return { customise, customising, confirmDialog };
}
