import { accentClassFor } from '@myclash/ui';
import { getServerT } from '@/i18n/server-locale';

export interface LeagueDecidingTiebreak {
  key: 'total_points' | 'participation_count' | 'medal_count' | 'double_hit_average';
  direction: 'asc' | 'desc';
  mine: number;
  theirs: number;
}

export interface LeagueStandingRow {
  id: string;
  ranking_group_key: string;
  rank: number;
  total_points: number;
  participation_count: number;
  medal_count: number;
  double_hit_average: string;
  decidingTiebreak?: LeagueDecidingTiebreak | null;
  per_tournament: Array<{ tournamentId: string; finalRank: number; leaguePoints: number }>;
  fighters?: {
    display_name?: string | null;
    clubs?: { name?: string | null; city?: string | null } | null;
  };
}

export interface LeagueStandingsColumn {
  tournament_id: string;
  tournaments?: { name?: string | null; events?: { name?: string | null } | null } | null;
}

/** A ranking_group_key ('longsword' or 'longsword::open') as a readable header. */
function formatGroupKey(key: string): string {
  return key
    .split('::')
    .map((part) => {
      const spaced = part.replace(/-/g, ' ').trim();
      return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : spaced;
    })
    .filter(Boolean)
    .join(' · ');
}

function rankBadge(rank: number): React.ReactNode {
  const token = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : null;
  if (!token) {
    return <span className="text-sm font-semibold tabular-nums text-muted">{rank}</span>;
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

/**
 * The standings body: one section per `ranking_group_key`, each with its
 * champion card(s) (rank-1 rows) above a table carrying a Medals column, a
 * deciding-tie-break chip, and the per-tournament breakdown. A pure server
 * component — rows arrive pre-sorted (group then rank) from the API.
 */
export async function StandingsGroups({
  rows,
  columns,
}: {
  rows: LeagueStandingRow[];
  columns: LeagueStandingsColumn[];
}) {
  const t = await getServerT();

  // Rows arrive ordered by ranking_group_key then rank, so grouping by
  // insertion order preserves both.
  const groups = new Map<string, LeagueStandingRow[]>();
  for (const row of rows) {
    const key = row.ranking_group_key || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  const groupKeys = [...groups.keys()];
  const multiGroup = groupKeys.length > 1;

  return (
    <div className="flex flex-col gap-8">
      {groupKeys.map((groupKey) => {
        const groupRows = groups.get(groupKey)!;
        const champions = groupRows.filter((row) => row.rank === 1);
        return (
          <section key={groupKey || 'default'} className="flex flex-col gap-3">
            {multiGroup && groupKey && (
              <h2 className="font-display font-semibold text-lg text-foreground">
                {formatGroupKey(groupKey)}
              </h2>
            )}

            {champions.length > 0 && (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {champions.map((row) => {
                  const club = row.fighters?.clubs?.name;
                  return (
                    <li
                      key={`champion-${row.id}`}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm"
                    >
                      <span
                        className={[
                          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm tabular-nums',
                          accentClassFor('gold'),
                        ].join(' ')}
                        aria-hidden="true"
                      >
                        1
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                          {t('publicApp.leagues.championLabel')}
                        </p>
                        <p className="truncate font-semibold text-foreground">
                          {row.fighters?.display_name ?? '—'}
                        </p>
                        {club && <p className="truncate text-xs text-muted">{club}</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-lg font-bold tabular-nums text-foreground">
                          {row.total_points}
                        </p>
                        <p className="text-[11px] uppercase tracking-wide text-muted">
                          {t('publicApp.leagues.totalPointsColumn')}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
              <table className="min-w-full text-sm">
                <thead className="bg-background text-foreground-secondary">
                  <tr className="text-xs font-semibold uppercase tracking-wider">
                    <th className="px-3 py-2 text-left">{t('publicApp.leagues.rankColumn')}</th>
                    <th className="px-3 py-2 text-left">{t('publicApp.leagues.fighterColumn')}</th>
                    <th className="px-3 py-2 text-left">{t('publicApp.leagues.clubColumn')}</th>
                    <th className="px-3 py-2 text-right">
                      {t('publicApp.leagues.totalPointsColumn')}
                    </th>
                    <th className="px-3 py-2 text-right">{t('publicApp.leagues.medalsColumn')}</th>
                    {columns.map((column) => (
                      <th key={column.tournament_id} className="px-3 py-2 text-left">
                        {column.tournaments?.events?.name ?? column.tournaments?.name ?? '—'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-foreground">
                  {groupRows.map((row) => {
                    const dt = row.decidingTiebreak;
                    // Only surface the chip when a *secondary* criterion broke a
                    // points tie — a plain points gap is already visible in the
                    // Total column and would just be noise on every row.
                    const showTiebreak = dt != null && dt.key !== 'total_points';
                    return (
                      <tr key={row.id} className="border-t border-border even:bg-background/50">
                        <td className="px-3 py-2 align-top">{rankBadge(row.rank)}</td>
                        <td className="px-3 py-2 align-top">
                          <p className="font-medium text-foreground">
                            {row.fighters?.display_name ?? '—'}
                          </p>
                          {showTiebreak && (
                            <p className="mt-0.5 text-xs text-muted">
                              {t('publicApp.leagues.tiebreakChip', {
                                label: t(`publicApp.leagues.tiebreak.${dt.key}`),
                                mine: dt.mine,
                                theirs: dt.theirs,
                              })}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-foreground-secondary">
                          {row.fighters?.clubs?.name ?? '—'}
                        </td>
                        <td className="px-3 py-2 align-top text-right font-semibold tabular-nums text-foreground">
                          {row.total_points}
                        </td>
                        <td className="px-3 py-2 align-top text-right tabular-nums text-foreground-secondary">
                          {row.medal_count}
                        </td>
                        {columns.map((column) => {
                          const result = row.per_tournament.find(
                            (item) => item.tournamentId === column.tournament_id,
                          );
                          return (
                            <td
                              key={column.tournament_id}
                              className="px-3 py-2 align-top tabular-nums text-foreground-secondary"
                            >
                              {result ? (
                                `${result.finalRank} / ${result.leaguePoints}`
                              ) : (
                                <span className="text-muted">{t('publicApp.leagues.dnp')}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
