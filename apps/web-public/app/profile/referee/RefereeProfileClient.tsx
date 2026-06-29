'use client';

import { useEffect, useState } from 'react';
import { Card, SkillBadge } from '@myclash/ui';
import { useI18n } from '../../../src/i18n/I18nProvider';

interface RefereeStats {
  totalMatches: number;
  averageRefereeTimeMs: number;
  roles: {
    arbitre_declarant: number;
    arbitre_assesseur: number;
    arbitre_table: number;
  };
  cards: {
    yellow: number;
    red: number;
    black: number;
  };
  bestBuddies: Array<{
    userId: string;
    displayName: string | null;
    matchesTogether: number;
  }>;
  history?: Array<{
    matchId: string;
    role: string | null;
    eventName: string | null;
    tournamentName: string | null;
    weapon: string | null;
    scheduledAt: string | null;
    durationMs: number;
    skillId: string | null;
    skillName: string | null;
    skillColor: string | null;
  }>;
}

function formatDuration(
  ms: number,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  if (ms <= 0) return t('common.none');
  return t('publicApp.fighterProfile.minutes', { count: Math.round(ms / 60000) });
}

export function RefereeProfileClient({ apiUrl }: { apiUrl: string }) {
  const { t } = useI18n();
  const [stats, setStats] = useState<RefereeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/fighters/me/referee-stats`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('referee-stats');
        setStats((await response.json()) as RefereeStats);
      })
      .catch(() => {
        setError(t('publicApp.fighterProfile.loadRefereeStatsError'));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [apiUrl, t]);

  if (loading) {
    return (
      <Card className="text-sm text-muted">
        {t('publicApp.fighterProfile.loadingRefereeStats')}
      </Card>
    );
  }

  if (error || !stats) {
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-4">
        <p className="text-sm text-danger">
          {error ?? t('publicApp.fighterProfile.loadRefereeStatsError')}
        </p>
        <p className="mt-2 text-xs text-muted">{t('publicApp.fighterProfile.accessRequired')}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent">
          {t('publicApp.fighterProfile.refereeHistory')}
        </h2>
        {stats.history?.length ? (
          <div className="divide-y divide-border">
            {stats.history.slice(0, 20).map((entry) => (
              <div key={entry.matchId} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-semibold text-foreground">
                  {entry.eventName ?? t('common.unknown')}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{entry.tournamentName ?? t('common.unknown')}</span>
                  <span>-</span>
                  <span>{entry.weapon ?? t('common.unknown')}</span>
                  <span>-</span>
                  {entry.skillName && entry.skillColor ? (
                    <SkillBadge color={entry.skillColor} label={entry.skillName} size="xs" />
                  ) : (
                    <span>{entry.role ?? t('common.unknown')}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{t('publicApp.fighterProfile.noRefereeStats')}</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent">
          {t('publicApp.fighterProfile.refereeing')}
        </h2>
        <div className="grid gap-2">
          <RefereeStat
            label={t('publicApp.fighterProfile.refereeMatches')}
            value={stats.totalMatches}
          />
          <RefereeStat
            label={t('publicApp.fighterProfile.averageRefereeTime')}
            value={formatDuration(stats.averageRefereeTimeMs, t)}
          />
          <RefereeStat
            label={t('publicApp.fighterProfile.arbitreDeclarant')}
            value={stats.roles.arbitre_declarant}
          />
          <RefereeStat
            label={t('publicApp.fighterProfile.arbitreAssesseur')}
            value={stats.roles.arbitre_assesseur}
          />
          <RefereeStat
            label={t('publicApp.fighterProfile.arbitreTable')}
            value={stats.roles.arbitre_table}
          />
          <RefereeStat
            label={t('publicApp.fighterProfile.yellowCards')}
            value={stats.cards.yellow}
          />
          <RefereeStat label={t('publicApp.fighterProfile.redCards')} value={stats.cards.red} />
          <RefereeStat label={t('publicApp.fighterProfile.blackCards')} value={stats.cards.black} />
        </div>

        {stats.bestBuddies.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">
              {t('publicApp.fighterProfile.bestRefereeBuddies')}
            </h3>
            <ul className="space-y-2 text-sm text-foreground-secondary">
              {stats.bestBuddies.slice(0, 5).map((buddy) => (
                <li key={buddy.userId} className="flex items-center justify-between gap-3">
                  <span>{buddy.displayName ?? t('common.unknown')}</span>
                  <span className="text-xs text-muted">
                    {t('publicApp.fighterProfile.matchesTogether', {
                      count: buddy.matchesTogether,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

function RefereeStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-3">
      <p className="text-[11px] uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-foreground">{value}</p>
    </div>
  );
}
