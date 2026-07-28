'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminPageHeader } from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';

interface RankingRow {
  league_id: string;
  fighter_id: string;
  ranking_group_key: string;
  rank: number;
  total_points: number;
  participation_count: number;
  medal_count: number;
  double_hits_total: number;
  double_hit_average: number;
  global_persons?: {
    display_name: string | null;
    clubs?: { name: string | null; city: string | null } | null;
  } | null;
}

interface StandingsPayload {
  league: {
    id: string;
    name: string;
    slug: string;
    season_year: number;
    status: string;
    public_visibility: boolean;
    scoring_config: {
      rankingDimensions?: 'weapon' | 'weapon_category';
    } | null;
  };
  columns: Array<{
    tournament_id: string;
    tournaments?: {
      id: string;
      name: string | null;
      event_id: string;
      events?: { name: string | null; start_date: string | null } | null;
    } | null;
  }>;
  rows: RankingRow[];
  pendingTournaments?: Array<{ tournamentId: string; name: string; eventName: string }>;
}

interface ClubRow {
  clubId: string;
  name: string;
  city: string | null;
  totalPoints: number;
  memberCount: number;
  medalCount: number;
  topMembers: Array<{ fighterId: string; name: string; points: number }>;
}

interface ClubStandingsPayload {
  clubs: ClubRow[];
  unaffiliated: { totalPoints: number; memberCount: number; medalCount: number } | null;
}

const apiUrl = getPublicApiUrl();

function fighterDisplayName(row: RankingRow): string {
  const name = row.global_persons?.display_name?.trim();
  if (name) return name;
  return `Fighter ${row.fighter_id.slice(0, 8)}`;
}

function fighterClubLabel(row: RankingRow): string | null {
  const club = row.global_persons?.clubs;
  if (!club?.name) return null;
  return club.city ? `${club.name} · ${club.city}` : club.name;
}

export default function AdminLeagueRankingPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const leagueId = params.id;
  const [data, setData] = useState<StandingsPayload | null>(null);
  const [clubData, setClubData] = useState<ClubStandingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/standings`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? t('admin.common.loadStandingsFailed'));
        }
        return (await res.json()) as StandingsPayload;
      })
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('admin.common.loadStandingsFailed'));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [leagueId, t]);

  useEffect(() => {
    if (!leagueId) return;
    const controller = new AbortController();
    // Club standings are supplementary: on failure the sub-table just stays
    // hidden, so this fetch never surfaces an error into the main page state.
    fetch(`${apiUrl}/api/v1/admin/leagues/${leagueId}/club-standings`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<ClubStandingsPayload>) : null))
      .then((payload) => setClubData(payload))
      .catch(() => {
        /* ignore — supplementary data */
      });
    return () => controller.abort();
  }, [leagueId]);

  // Group rows by ranking_group_key so leagues with weapon_category
  // dimension render one sub-table per group.
  const groupedRows = (data?.rows ?? []).reduce<Record<string, RankingRow[]>>((acc, row) => {
    const key = row.ranking_group_key || '—';
    if (!acc[key]) acc[key] = [];
    acc[key]!.push(row);
    return acc;
  }, {});
  const groupKeys = Object.keys(groupedRows).sort();

  return (
    <main id="main-content" className="mx-auto w-full max-w-[110rem] px-6 py-12 lg:px-8">
      <Link
        href="/admin/leagues"
        className="mb-3 inline-flex items-center gap-1 rounded text-sm font-medium text-foreground-secondary hover:text-foreground"
      >
        {t('admin.adminLeagues.backToLeagues')}
      </Link>
      <AdminPageHeader
        eyebrow="League ranking"
        title={data?.league.name ?? 'League ranking'}
        subtitle={
          data
            ? `${data.league.season_year} · ${data.columns.length} tournament${
                data.columns.length === 1 ? '' : 's'
              } · ${data.rows.length} fighter${data.rows.length === 1 ? '' : 's'}`
            : null
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {loading && (
        <div className="rounded-lg border border-border bg-surface p-12 text-center text-sm text-muted">
          {t('admin.adminLeagues.loading')}
        </div>
      )}

      {!loading && data && (data.pendingTournaments?.length ?? 0) > 0 && (
        <div className="mb-4 rounded-md border border-dashed border-border bg-background px-4 py-3 text-sm text-muted">
          {t('admin.adminLeagues.pendingNote', { count: data.pendingTournaments!.length })}
        </div>
      )}

      {!loading && data && data.rows.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-12 text-center text-sm text-muted">
          {t('admin.adminLeagues.emptyRankingsBefore')}
          <code className="mx-1 rounded bg-background px-1 font-mono">league_rankings</code>
          {t('admin.adminLeagues.emptyRankingsAfter')}
        </div>
      )}

      {!loading && data && data.rows.length > 0 && (
        <div className="space-y-6">
          {groupKeys.map((key) => (
            <section
              key={key}
              className="overflow-x-auto rounded-lg border border-border bg-surface shadow-sm"
            >
              {groupKeys.length > 1 && (
                <header className="border-b border-border bg-background px-4 py-2 text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
                  {key}
                </header>
              )}
              <table className="w-full min-w-[720px] text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border bg-background text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 w-16 text-center">
                      {t('admin.adminLeagues.colRank')}
                    </th>
                    <th className="px-4 py-3">{t('admin.adminLeagues.colFighter')}</th>
                    <th className="px-4 py-3 text-center">{t('admin.adminLeagues.colPoints')}</th>
                    <th className="px-4 py-3 text-center">
                      {t('admin.adminLeagues.colParticipations')}
                    </th>
                    <th className="px-4 py-3 text-center">{t('admin.adminLeagues.colMedals')}</th>
                    <th className="px-4 py-3 text-center">
                      {t('admin.adminLeagues.colAvgDoubleHits')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groupedRows[key]!.map((row) => {
                    const club = fighterClubLabel(row);
                    return (
                      <tr
                        key={`${row.ranking_group_key}-${row.fighter_id}`}
                        className="border-b border-border"
                      >
                        <td className="px-4 py-3 text-center font-mono font-semibold text-foreground-secondary tabular-nums">
                          {row.rank}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{fighterDisplayName(row)}</p>
                          {club && <p className="mt-0.5 text-xs text-muted">{club}</p>}
                        </td>
                        <td className="px-4 py-3 text-center text-foreground-secondary tabular-nums">
                          {row.total_points}
                        </td>
                        <td className="px-4 py-3 text-center text-foreground-secondary tabular-nums">
                          {row.participation_count}
                        </td>
                        <td className="px-4 py-3 text-center text-foreground-secondary tabular-nums">
                          {row.medal_count}
                        </td>
                        <td className="px-4 py-3 text-center text-foreground-secondary tabular-nums">
                          {row.double_hit_average.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      {!loading && clubData && clubData.clubs.length > 0 && (
        <section className="mt-8 overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
          <header className="border-b border-border bg-background px-4 py-2 text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
            {t('admin.adminLeagues.clubStandingsTitle')}
          </header>
          <table className="w-full min-w-[640px] text-sm border-collapse">
            <thead>
              <tr className="border-b border-border bg-background text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 w-16 text-center">{t('admin.adminLeagues.colRank')}</th>
                <th className="px-4 py-3">{t('admin.adminLeagues.clubStandingsClub')}</th>
                <th className="px-4 py-3 text-center">
                  {t('admin.adminLeagues.clubStandingsMembers')}
                </th>
                <th className="px-4 py-3 text-center">{t('admin.adminLeagues.colMedals')}</th>
                <th className="px-4 py-3 text-center">{t('admin.adminLeagues.colPoints')}</th>
              </tr>
            </thead>
            <tbody>
              {clubData.clubs.map((club, index) => (
                <tr key={club.clubId} className="border-b border-border">
                  <td className="px-4 py-3 text-center font-mono font-semibold text-foreground-secondary tabular-nums">
                    {index + 1}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{club.name}</p>
                    {club.city && <p className="mt-0.5 text-xs text-muted">{club.city}</p>}
                  </td>
                  <td className="px-4 py-3 text-center text-foreground-secondary tabular-nums">
                    {club.memberCount}
                  </td>
                  <td className="px-4 py-3 text-center text-foreground-secondary tabular-nums">
                    {club.medalCount}
                  </td>
                  <td className="px-4 py-3 text-center text-foreground-secondary tabular-nums">
                    {club.totalPoints}
                  </td>
                </tr>
              ))}
              {clubData.unaffiliated && (
                <tr className="border-b border-border bg-background/40 text-muted">
                  <td className="px-4 py-3 text-center">—</td>
                  <td className="px-4 py-3 italic">
                    {t('admin.adminLeagues.clubStandingsUnaffiliated')}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {clubData.unaffiliated.memberCount}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {clubData.unaffiliated.medalCount}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {clubData.unaffiliated.totalPoints}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
