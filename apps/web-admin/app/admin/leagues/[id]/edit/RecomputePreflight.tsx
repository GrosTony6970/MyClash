'use client';

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

interface Preflight {
  blocking: Array<{ tournamentName: string; fighterNames: string[] }>;
  unstableIdentities: string[];
}

function usePreflight(leagueId: string, refreshToken: number): Preflight | null {
  const [preflight, setPreflight] = useState<Preflight | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const r = await apiRequest<Preflight>(
        getPublicApiUrl(),
        `/api/v1/admin/leagues/${leagueId}/recompute-preflight`,
        { signal },
      );
      if (r.ok) {
        setPreflight(r.data);
        return;
      }
      // Silence beats a false all-clear: a panel that cannot load shows nothing.
      // A refusal leaves whatever is already up; only a dropped connection or
      // an unreadable body clears it, and an abort is a newer load's business.
      if (r.kind === 'network') setPreflight(null);
    },
    [leagueId],
  );

  // Deferred off the effect body — setState inside one cascades renders and the
  // repo lints it at max-warnings 0.
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => {
      controller.abort();
    };
  }, [load, refreshToken]);

  return preflight;
}

/**
 * What a recompute would refuse, shown BEFORE the organiser presses the button.
 *
 * `validateContributionIdentities` aborts the whole run with a 400 naming five
 * people at most, so a big roster takes as many retries as it has broken
 * fighters divided by five. This lists all of them, grouped by tournament.
 */
export function RecomputePreflight({
  leagueId,
  refreshToken,
}: {
  leagueId: string;
  refreshToken: number;
}) {
  const { t } = useI18n();
  const preflight = usePreflight(leagueId, refreshToken);

  if (!preflight) return null;
  const { blocking, unstableIdentities } = preflight;
  if (blocking.length === 0 && unstableIdentities.length === 0) return null;

  return (
    <div className="mt-3 space-y-3">
      {blocking.length > 0 && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3">
          <p className="text-sm font-semibold text-danger">
            {t('admin.adminLeagues.preflight.blockingTitle')}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t('admin.adminLeagues.preflight.blockingBody')}
          </p>
          <ul className="mt-2 space-y-1">
            {blocking.map((row) => (
              <li key={row.tournamentName} className="text-xs text-foreground-secondary">
                <span className="font-semibold">{row.tournamentName}</span>{' '}
                {row.fighterNames.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {unstableIdentities.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
          <p className="text-sm font-semibold text-warning">
            {t('admin.adminLeagues.preflight.unstableTitle', { count: unstableIdentities.length })}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t('admin.adminLeagues.preflight.unstableBody')}
          </p>
          <p className="mt-2 text-xs text-foreground-secondary">{unstableIdentities.join(', ')}</p>
        </div>
      )}
    </div>
  );
}
