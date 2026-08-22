'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useEffect, useState } from 'react';
import { Button, useToast } from '@myclash/ui';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

/**
 * Integrity banner for the tournament settings page. Asks the API whether this
 * tournament's effective (scoring, penalty) behaviour has drifted from its
 * stored content-hash stamp — the realistic cause is a super-admin editing the
 * never-frozen built-in penalty ruleset. When drifted, the organizer can
 * acknowledge, which re-stamps the fingerprint to the current behaviour.
 * Renders nothing when there is no drift (the common case).
 */
export function RulesetDriftBanner({ tournamentId }: { tournamentId: string }) {
  const { t } = useI18n();

  const toast = useToast();
  const [drifted, setDrifted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    // Drift is a best-effort integrity hint — never surface a read failure.
    void apiRequest<{ drifted?: boolean }>(
      apiUrl,
      `/api/v1/tournaments/${tournamentId}/ruleset-drift`,
      { signal: controller.signal },
    ).then((r) => {
      if (!cancelled && r.ok && r.data.drifted) setDrifted(true);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [tournamentId]);

  async function acknowledge() {
    setBusy(true);
    try {
      const r = await apiRequest(
        apiUrl,
        `/api/v1/tournaments/${tournamentId}/acknowledge-ruleset-drift`,
        { method: 'POST' },
      );
      if (!r.ok) {
        const message = failureMessage(
          r,
          t,
          t('organizer.tournaments.settings.drift.acknowledgeError'),
        );
        if (message) toast.error(message);
        return;
      }
      setDrifted(false);
      toast.success(t('organizer.tournaments.settings.drift.acknowledged'));
    } finally {
      setBusy(false);
    }
  }

  if (!drifted) return null;

  return (
    <div role="status" className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-warning">
            {t('organizer.tournaments.settings.drift.title')}
          </p>
          <p className="mt-0.5 text-sm text-foreground-secondary">
            {t('organizer.tournaments.settings.drift.body')}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void acknowledge()}
          disabled={busy}
          className="shrink-0"
        >
          {t('organizer.tournaments.settings.drift.acknowledge')}
        </Button>
      </div>
    </div>
  );
}
