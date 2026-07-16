'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { useI18n } from '@/i18n/I18nProvider';
import { formatGroup, rankMedal } from '../helpers';

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

interface StandingRow {
  id: string;
  fighter_id: string;
  rank: number;
  total_points: number;
  participation_count: number;
  medal_count: number;
  global_persons?: { display_name?: string | null; clubs?: { name?: string | null } | null } | null;
}

type Status = 'loading' | 'ready' | 'notfound' | 'error';

/**
 * In-/me classement for one league. Resolves the user's membership + fighterId
 * via /api/v1/me/leagues, then reads the public standings for the selected
 * category and highlights the signed-in fighter's row.
 */
export default function LeagueDetailClient() {
  const { t } = useI18n();
  const { slug } = useParams<{ slug: string }>();
  const apiUrl = useMemo(() => getPublicApiUrl(), []);
  const [fighterId, setFighterId] = useState<string | null>(null);
  const [league, setLeague] = useState<MyLeague | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [rows, setRows] = useState<StandingRow[]>([]);
  const [status, setStatus] = useState<Status>('loading');

  // Step 1 — the user's membership in this league (gives leagueId + fighterId).
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/me/leagues`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('load');
        const data = (await res.json()) as { fighterId: string | null; leagues: MyLeague[] };
        const found = data.leagues.find((l) => l.leagueSlug === slug) ?? null;
        if (!found) {
          setStatus('notfound');
          return;
        }
        setFighterId(data.fighterId);
        setLeague(found);
        setGroup(found.groups[0]?.groupKey ?? null);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus('error');
      });
    return () => controller.abort();
  }, [apiUrl, slug]);

  // Step 2 — the full standings for the selected category.
  useEffect(() => {
    if (!league || !group) return;
    const controller = new AbortController();
    fetch(
      `${apiUrl}/api/v1/leagues/${league.leagueId}/standings?group=${encodeURIComponent(group)}`,
      { credentials: 'include', signal: controller.signal },
    )
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json()) as { rows?: StandingRow[] };
          setRows(data.rows ?? []);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [apiUrl, league, group]);

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <Link href="/me/leagues" className="text-xs font-semibold text-accent hover:underline">
          ← {t('publicApp.me.leagues.backToList')}
        </Link>

        {status === 'loading' && <p className="text-sm text-muted">{t('common.loading')}</p>}
        {status === 'error' && (
          <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {t('publicApp.me.leagues.loadError')}
          </p>
        )}
        {status === 'notfound' && (
          <EmptyState
            title={t('publicApp.me.leagues.notRankedTitle')}
            description={t('publicApp.me.leagues.notRankedHint')}
          />
        )}

        {status === 'ready' && league && (
          <>
            <header>
              <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
                {league.leagueName}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {t('publicApp.me.leagues.season', { year: league.seasonYear })}
              </p>
            </header>

            {league.groups.length > 1 && (
              <div role="tablist" className="flex flex-wrap gap-1">
                {league.groups.map((g) => {
                  const active = g.groupKey === group;
                  return (
                    <button
                      key={g.groupKey}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setGroup(g.groupKey)}
                      className={[
                        'min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors',
                        active
                          ? 'bg-accent text-accent-foreground'
                          : 'border border-border text-muted hover:text-foreground',
                      ].join(' ')}
                    >
                      {formatGroup(g.groupKey)}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="py-2 pl-3 pr-2 font-semibold">
                      {t('publicApp.me.leagues.colRank')}
                    </th>
                    <th className="py-2 pr-2 font-semibold">
                      {t('publicApp.me.leagues.colFighter')}
                    </th>
                    <th className="py-2 pr-2 text-right font-semibold">
                      {t('publicApp.me.leagues.colPoints')}
                    </th>
                    <th className="hidden py-2 pr-2 text-right font-semibold sm:table-cell">
                      {t('publicApp.me.leagues.colMedals')}
                    </th>
                    <th className="hidden py-2 pr-3 text-right font-semibold sm:table-cell">
                      {t('publicApp.me.leagues.colEvents')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isMe = fighterId != null && row.fighter_id === fighterId;
                    const club = row.global_persons?.clubs?.name ?? null;
                    return (
                      <tr
                        key={row.id}
                        className={[
                          'border-b border-border/60 last:border-0',
                          isMe ? 'bg-accent/10' : '',
                        ].join(' ')}
                      >
                        <td className="py-2 pl-3 pr-2 font-semibold tabular-nums text-foreground">
                          {rankMedal(row.rank) && (
                            <span aria-hidden className="mr-1">
                              {rankMedal(row.rank)}
                            </span>
                          )}
                          {row.rank}
                        </td>
                        <td className="py-2 pr-2">
                          <span className="flex items-center gap-2">
                            <span className="min-w-0">
                              <span className="block truncate text-foreground">
                                {row.global_persons?.display_name ?? t('common.unknown')}
                              </span>
                              {club && (
                                <span className="block truncate text-xs text-muted">{club}</span>
                              )}
                            </span>
                            {isMe && (
                              <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[0.6rem] font-bold text-accent-foreground">
                                {t('publicApp.me.leagues.youChip')}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="py-2 pr-2 text-right font-semibold tabular-nums text-foreground">
                          {row.total_points}
                        </td>
                        <td className="hidden py-2 pr-2 text-right tabular-nums text-muted sm:table-cell">
                          {row.medal_count}
                        </td>
                        <td className="hidden py-2 pr-3 text-right tabular-nums text-muted sm:table-cell">
                          {row.participation_count}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Link
              href={`/leagues/${slug}`}
              className="text-xs font-semibold text-accent hover:underline"
            >
              {t('publicApp.me.leagues.viewFullClassement')} →
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
