'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@myclash/ui';
import type { StatusSemantic } from '@myclash/ui';
import { localeToBcp47, type AppLocale } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

type FreshnessState = 'frozen' | 'never_computed' | 'fresh' | 'stale';

interface FreshnessReport {
  state: FreshnessState;
  computedAt: string | null;
  changedTournamentNames: string[];
}

/**
 * Recompute is never triggered by a match completing — only an event status
 * change, the status ticker and the two manual endpoints call it. So a league
 * table is stale by DEFAULT and fresh only until the next result lands, which
 * is the opposite of what someone reading a standings page assumes. This badge
 * exists to make that assumption visible rather than silently wrong.
 */
const SEMANTIC: Record<FreshnessState, StatusSemantic> = {
  frozen: 'archived',
  never_computed: 'pending',
  fresh: 'done',
  stale: 'paused',
};

function useLeagueFreshness(leagueId: string, refreshToken: number): FreshnessReport | null {
  const [report, setReport] = useState<FreshnessReport | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const r = await apiRequest<FreshnessReport>(
        getPublicApiUrl(),
        `/api/v1/admin/leagues/${leagueId}/freshness`,
        { signal },
      );
      if (r.ok) {
        setReport(r.data);
        return;
      }
      // A badge that cannot load says nothing rather than claiming freshness.
      // A refusal leaves whatever is already up; only a dropped connection or
      // an unreadable body clears it, and an abort is a newer load's business.
      if (r.kind === 'network') setReport(null);
    },
    [leagueId],
  );

  // Deferred off the effect body: setState called synchronously inside one
  // cascades renders and the repo lints it at max-warnings 0.
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => {
      controller.abort();
    };
  }, [load, refreshToken]);

  return report;
}

function formatWhen(value: string, locale: AppLocale): string {
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function LeagueFreshnessBadge({
  leagueId,
  refreshToken,
}: {
  leagueId: string;
  /** Bump to refetch — the parent does so after a recompute succeeds. */
  refreshToken: number;
}) {
  const { t, locale } = useI18n();
  const report = useLeagueFreshness(leagueId, refreshToken);

  if (!report) return null;
  const changed = report.changedTournamentNames;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge semantic={SEMANTIC[report.state]} surface="light">
        {t(`admin.adminLeagues.freshness.${report.state}`)}
      </StatusBadge>
      {report.computedAt && (
        <span className="text-xs text-muted">
          {t('admin.adminLeagues.freshness.computedAt', {
            date: formatWhen(report.computedAt, locale),
          })}
        </span>
      )}
      {changed.length > 0 && (
        /* Named, not counted: "2 tournaments changed" tells the organiser to
           recompute, which they would do anyway — the names tell them WHICH
           results moved, which is what they actually want to check. */
        <span className="text-xs text-foreground-secondary">
          {t('admin.adminLeagues.freshness.changedSince', { list: changed.join(', ') })}
        </span>
      )}
    </div>
  );
}
