'use client';

/**
 * The podium for a tournament that Swiss decides on its own.
 *
 * `derivePodium` reads bracket slots, and a Swiss phase has none — so a
 * Swiss-only tournament would show no medals anywhere public even after the
 * organiser finalised it. The top three of the ranked standings ARE the podium
 * there; the same three names the placement service writes to the league.
 *
 * Only rendered once the phase is settled (finalised, or every round complete),
 * because a podium shown mid-phase is a leaderboard pretending to be a result.
 */

import { useEffect, useState } from 'react';
import { MedalPodium, type PodiumData } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { useI18n } from '@myclash/next-i18n/client';

interface SwissStandingsRow {
  registrationId: string;
  displayName: string;
}

export function SwissPodiumPanel({ tournamentId }: { tournamentId: string }) {
  const { t } = useI18n();
  const [podium, setPodium] = useState<PodiumData | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${getPublicApiUrl()}/api/v1/tournaments/${tournamentId}/swiss-standings`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const rows = (data as { rows?: SwissStandingsRow[] } | null)?.rows ?? [];
        if (rows.length === 0) return;
        setPodium({
          gold: rows[0] ? { fighterName: rows[0].displayName } : null,
          silver: rows[1] ? { fighterName: rows[1].displayName } : null,
          bronze: rows[2] ? { fighterName: rows[2].displayName } : null,
          fourth: rows[3] ? { fighterName: rows[3].displayName } : null,
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [tournamentId]);

  if (!podium) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
        {t('publicApp.tournament.swiss.podiumPending')}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <MedalPodium podium={podium} showBronze={Boolean(podium.bronze)} />
    </div>
  );
}
