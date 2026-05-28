import { notFound } from 'next/navigation';
import { getApiUrl } from '@/lib/api-url';
import { t } from '@myclash/i18n';

interface League {
  id: string;
  name: string;
  season_year: number;
  description: string | null;
}

interface StandingRow {
  id: string;
  ranking_group_key: string;
  rank: number;
  total_points: number;
  participation_count: number;
  medal_count: number;
  double_hit_average: string;
  per_tournament: Array<{ tournamentId: string; finalRank: number; leaguePoints: number }>;
  fighters?: {
    display_name?: string | null;
    clubs?: { name?: string | null; city?: string | null } | null;
  };
}

interface Standings {
  league: League;
  columns: Array<{
    tournament_id: string;
    tournaments?: { name?: string | null; events?: { name?: string | null } | null } | null;
  }>;
  rows: StandingRow[];
}

async function fetchLeague(apiUrl: string, slug: string): Promise<League | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/leagues/${slug}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as League;
  } catch {
    return null;
  }
}

async function fetchStandings(apiUrl: string, leagueId: string): Promise<Standings | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/leagues/${leagueId}/standings`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as Standings;
  } catch {
    return null;
  }
}

export default async function PublicLeagueStandingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const apiUrl = getApiUrl();
  const league = await fetchLeague(apiUrl, slug);
  if (!league) notFound();
  const standings = await fetchStandings(apiUrl, league.id);
  const columns = standings?.columns ?? [];
  const rows = standings?.rows ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-white">{league.name}</h1>
        <p className="text-sm text-gray-400 mt-1">{league.season_year}</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-white/10 text-gray-300">
            <tr>
              <th className="px-3 py-2 text-left">{t('admin.leagues.standings')}</th>
              <th className="px-3 py-2 text-left">{t('admin.leagues.fighter')}</th>
              <th className="px-3 py-2 text-left">{t('admin.leagues.club')}</th>
              <th className="px-3 py-2 text-right">{t('admin.leagues.totalPoints')}</th>
              {columns.map((column) => (
                <th key={column.tournament_id} className="px-3 py-2 text-left">
                  {column.tournaments?.events?.name ?? column.tournaments?.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-white/10 text-gray-100">
                <td className="px-3 py-2">{medal(row.rank)}</td>
                <td className="px-3 py-2">{row.fighters?.display_name ?? row.id}</td>
                <td className="px-3 py-2">{row.fighters?.clubs?.name ?? t('common.unknown')}</td>
                <td className="px-3 py-2 text-right font-semibold">{row.total_points}</td>
                {columns.map((column) => {
                  const result = row.per_tournament.find(
                    (item) => item.tournamentId === column.tournament_id,
                  );
                  return (
                    <td key={column.tournament_id} className="px-3 py-2">
                      {result
                        ? `${result.finalRank} / ${result.leaguePoints}`
                        : t('admin.leagues.dnp')}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p className="text-sm text-gray-400 mt-5">{t('admin.leagues.empty')}</p>
      )}
    </main>
  );
}

function medal(rank: number): string {
  if (rank === 1) return '1';
  if (rank === 2) return '2';
  if (rank === 3) return '3';
  return String(rank);
}
