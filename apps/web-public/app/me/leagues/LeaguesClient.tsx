'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@myclash/ui';
import { getApiUrl } from '@/lib/api-url';
import { useI18n } from '@/i18n/I18nProvider';
import { formatGroup, rankMedal } from './helpers';

interface MyLeagueGroup {
  groupKey: string;
  rank: number;
  totalPoints: number;
  participationCount: number;
  medalCount: number;
}

interface MyLeague {
  leagueId: string;
  leagueName: string;
  leagueSlug: string;
  seasonYear: number;
  logoUrl: string | null;
  groups: MyLeagueGroup[];
}

type Status = 'loading' | 'ready' | 'error';

/**
 * "My leagues" — every published league the signed-in fighter is ranked in,
 * one card per league with their per-category rank/points. Each card opens the
 * in-/me classement (self-highlighted). Resolves the API URL on the client.
 */
export default function LeaguesClient() {
  const { t } = useI18n();
  const apiUrl = useMemo(() => getApiUrl(), []);
  const [leagues, setLeagues] = useState<MyLeague[]>([]);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/me/leagues`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('load');
        const data = (await res.json()) as { leagues?: MyLeague[] };
        setLeagues(data.leagues ?? []);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus('error');
      });
    return () => controller.abort();
  }, [apiUrl]);

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.personalShell.role')}
          </p>
          <h1 className="mt-2 font-display font-bold text-2xl sm:text-3xl text-foreground">
            {t('publicApp.me.leagues.title')}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">{t('publicApp.me.leagues.subtitle')}</p>
        </header>

        {status === 'loading' && <p className="text-sm text-muted">{t('common.loading')}</p>}
        {status === 'error' && (
          <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {t('publicApp.me.leagues.loadError')}
          </p>
        )}
        {status === 'ready' && leagues.length === 0 && (
          <EmptyState
            title={t('publicApp.me.leagues.empty')}
            description={t('publicApp.me.leagues.emptyHint')}
          />
        )}

        {leagues.map((league) => (
          <Link
            key={league.leagueId}
            href={`/me/leagues/${league.leagueSlug}`}
            className="block rounded-lg border border-border bg-surface p-4 shadow-sm transition-colors hover:border-accent/50"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-sm font-semibold text-foreground">{league.leagueName}</p>
              <p className="shrink-0 text-xs text-muted">
                {t('publicApp.me.leagues.season', { year: league.seasonYear })}
              </p>
            </div>
            <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
              {league.groups.map((group) => (
                <li
                  key={group.groupKey}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 truncate text-muted">{formatGroup(group.groupKey)}</span>
                  <span className="flex shrink-0 items-center gap-2 font-semibold text-foreground">
                    {rankMedal(group.rank) && <span aria-hidden>{rankMedal(group.rank)}</span>}
                    <span>{t('publicApp.me.leagues.rankValue', { rank: group.rank })}</span>
                    <span className="font-normal text-muted">
                      {t('publicApp.me.leagues.pointsValue', { points: group.totalPoints })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Link>
        ))}
      </div>
    </main>
  );
}
