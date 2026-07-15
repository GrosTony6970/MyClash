import Link from 'next/link';
import { notFound } from 'next/navigation';
import { t } from '@myclash/i18n';
import { accentClassFor } from '@myclash/ui';
import { getApiUrl, getPublicApiUrl } from '@/lib/api-url';

interface League {
  id: string;
  name: string;
  season_year: number;
  description: string | null;
  logo_url: string | null;
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

interface MemberEvent {
  id: string;
  name: string;
  slug: string;
  startDate: string;
  endDate: string | null;
  organization: { id: string; name: string };
}

async function fetchMemberEvents(apiUrl: string, leagueId: string): Promise<MemberEvent[]> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/leagues/${leagueId}/member-events`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return (await res.json()) as MemberEvent[];
  } catch {
    return [];
  }
}

function initialsFor(name: string | null | undefined): string {
  const value = (name ?? '').trim();
  if (!value) return '··';
  const parts = value.split(/\s+/u).filter(Boolean);
  if (parts.length >= 2) return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase();
  return value.slice(0, 2).toUpperCase();
}

function rankBadge(rank: number): React.ReactNode {
  const token = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : null;
  if (!token) {
    return <span className="text-sm font-semibold tabular-nums text-slate-500">{rank}</span>;
  }
  return (
    <span
      className={[
        'inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm tabular-nums',
        accentClassFor(token),
      ].join(' ')}
    >
      {rank}
    </span>
  );
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
  const [standings, memberEvents] = await Promise.all([
    fetchStandings(apiUrl, league.id),
    fetchMemberEvents(apiUrl, league.id),
  ]);
  const columns = standings?.columns ?? [];
  const rows = standings?.rows ?? [];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <Link
        href="/"
        className="inline-flex items-center text-sm font-semibold text-red-700 hover:text-red-800"
      >
        ← {t('publicApp.leagues.backToHome')}
      </Link>

      <section className="flex flex-col gap-4 border-y border-stone-200 py-6 sm:flex-row sm:items-start sm:py-8">
        {league.logo_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={league.logo_url}
            alt=""
            className="h-20 w-20 shrink-0 rounded-xl border border-stone-200 bg-white object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-slate-50 text-base font-semibold text-slate-500">
            {initialsFor(league.name)}
          </div>
        )}
        <div className="flex-1">
          <h1 className="mb-1 font-display font-bold text-2xl sm:text-3xl text-slate-900">
            {league.name}
          </h1>
          {league.season_year != null && (
            <p className="text-sm tabular-nums text-slate-500">{league.season_year}</p>
          )}
          {league.description && (
            <p className="mt-2 max-w-prose text-sm leading-6 text-slate-600">
              {league.description}
            </p>
          )}
          {rows.length > 0 && (
            <p className="mt-3 flex flex-wrap gap-4 text-sm">
              {/* getPublicApiUrl: these hrefs land in HTML — the SSR-side
                  getApiUrl() would leak the docker-internal host here. */}
              <a
                href={`${getPublicApiUrl()}/api/v1/leagues/${league.id}/final-report.csv`}
                className="font-semibold text-red-700 hover:text-red-800"
              >
                {t('publicApp.leagues.downloadReport')}
              </a>
              <a
                href={`${getPublicApiUrl()}/api/v1/leagues/${league.id}/final-report.print.html`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-red-700 hover:text-red-800"
              >
                {t('publicApp.leagues.printableReport')}
              </a>
            </p>
          )}
        </div>
      </section>

      {memberEvents.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display font-semibold text-lg sm:text-xl text-slate-900">
            {t('publicApp.leagues.memberEventsTitle')}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {memberEvents.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/e/${event.slug}`}
                  className="inline-flex flex-col rounded-lg border border-stone-200 bg-white px-4 py-2 shadow-sm transition-colors hover:border-red-400"
                >
                  <span className="text-sm font-semibold text-slate-900">{event.name}</span>
                  <span className="text-xs text-slate-500">{event.organization.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-100 p-6 text-center text-sm text-slate-500">
          {t('publicApp.leagues.empty')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-slate-600">
              <tr className="text-xs font-semibold uppercase tracking-wider">
                <th className="px-3 py-2 text-left">{t('publicApp.leagues.rankColumn')}</th>
                <th className="px-3 py-2 text-left">{t('publicApp.leagues.fighterColumn')}</th>
                <th className="px-3 py-2 text-left">{t('publicApp.leagues.clubColumn')}</th>
                <th className="px-3 py-2 text-right">{t('publicApp.leagues.totalPointsColumn')}</th>
                {columns.map((column) => (
                  <th key={column.tournament_id} className="px-3 py-2 text-left">
                    {column.tournaments?.events?.name ?? column.tournaments?.name ?? '—'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-slate-800">
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-stone-100 even:bg-slate-50/50">
                  <td className="px-3 py-2">{rankBadge(row.rank)}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">
                    {row.fighters?.display_name ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{row.fighters?.clubs?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                    {row.total_points}
                  </td>
                  {columns.map((column) => {
                    const result = row.per_tournament.find(
                      (item) => item.tournamentId === column.tournament_id,
                    );
                    return (
                      <td
                        key={column.tournament_id}
                        className="px-3 py-2 tabular-nums text-slate-700"
                      >
                        {result ? (
                          `${result.finalRank} / ${result.leaguePoints}`
                        ) : (
                          <span className="text-slate-400">{t('publicApp.leagues.dnp')}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
