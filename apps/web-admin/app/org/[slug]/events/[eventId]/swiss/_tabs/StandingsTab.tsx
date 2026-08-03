'use client';

/**
 * The Swiss standings, ruleset-driven like the pool ones.
 *
 * The API decides the columns — it prepends `swissPts` and whichever tiebreaks
 * the organiser put in the chain, so a reorder there changes this table with no
 * edit here. It also adds a `score` column when the ruleset declares none,
 * because ranking by the ruleset score is offered on every ruleset and nobody
 * should be placed on a number they cannot see.
 */

import { useCallback, useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { escapeCsvCell } from '@myclash/types';
import { StandingsHeaderCell } from '@/components/standings/StandingsHeaderCell';
import { useStandingsView } from '@/components/standings/useStandingsView';
import { getColumnHelp } from '@/components/standings/columnHelp';
import { getPublicApiUrl } from '@/lib/api-url';

interface StandingsColumn {
  key: string;
  label: string;
  type?: 'number' | 'string';
  sortDesc?: boolean;
  decimals?: number;
}

interface SwissRow {
  rank: number;
  registrationId: string;
  displayName: string;
  club: { id: string; name: string; abbreviation: string | null } | null;
  status: 'in_progress' | 'completed';
  stats: Record<string, number | string>;
  withdrawn: boolean;
  withdrawnAtRound: number | null;
  decidingTiebreak?: string | null;
}

interface SwissStandings {
  columns: StandingsColumn[];
  rankBy: 'swissPts' | 'rulesetScore';
  tiebreakChain: string[];
  roundsCompleted: number;
  roundCount: number;
  rows: SwissRow[];
}

export function StandingsTab({ tournamentId }: { tournamentId: string }) {
  const [data, setData] = useState<SwissStandings | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const res = await fetch(
          `${getPublicApiUrl()}/api/v1/tournaments/${tournamentId}/swiss-standings`,
          { credentials: 'include', signal },
        );
        if (res.ok) setData((await res.json()) as SwissStandings);
      } catch {
        // Left to the empty state — the page-level banner owns real errors.
      } finally {
        setLoading(false);
      }
    },
    [tournamentId],
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch lifecycle
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (loading && !data) return <p className="text-sm text-muted">{t('common.loading')}</p>;
  if (!data || data.rows.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted">{t('organizer.swiss.standings.empty')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {t('organizer.swiss.standings.after', {
            done: data.roundsCompleted,
            total: data.roundCount,
          })}{' '}
          · {t(`organizer.swiss.standings.rankedBy.${data.rankBy}`)}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background"
          >
            {t('actions.refresh')}
          </button>
          <button
            type="button"
            onClick={() => downloadCsv(data)}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background"
          >
            {t('organizer.swiss.standings.exportCsv')}
          </button>
        </div>
      </div>
      <SwissTable columns={data.columns} rows={data.rows} />
    </div>
  );
}

function SwissTable({ columns, rows }: { columns: StandingsColumn[]; rows: SwissRow[] }) {
  const { query, setQuery, view, sortKey, direction, toggle } = useStandingsView(rows);
  const sortAscLabel = t('admin.common.sortAscLabel');
  const sortDescLabel = t('admin.common.sortDescLabel');
  return (
    <div className="space-y-3">
      <input
        aria-label={t('organizer.pools.standings.searchFighter')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('organizer.pools.standings.searchFighter')}
        className="w-72 rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-background text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-16 px-4 py-2 text-center">
                <StandingsHeaderCell
                  label={t('organizer.pools.standings.rank')}
                  columnKey="rank"
                  currentKey={sortKey}
                  direction={direction}
                  onToggle={toggle}
                  help={getColumnHelp('rank', t)}
                  align="center"
                  tooltipAnchor="start"
                  ariaSortAsc={sortAscLabel}
                  ariaSortDesc={sortDescLabel}
                />
              </th>
              <th className="px-4 py-2">
                <StandingsHeaderCell
                  label={t('organizer.pools.standings.fighter')}
                  columnKey="fighter"
                  currentKey={sortKey}
                  direction={direction}
                  onToggle={toggle}
                  help={getColumnHelp('fighter', t)}
                  align="left"
                  tooltipAnchor="start"
                  ariaSortAsc={sortAscLabel}
                  ariaSortDesc={sortDescLabel}
                />
              </th>
              {columns.map((column, index) => (
                <th
                  key={column.key}
                  className={
                    column.key === 'swissPts'
                      ? 'bg-accent/10 px-4 py-2 text-center'
                      : 'px-4 py-2 text-center'
                  }
                >
                  <StandingsHeaderCell
                    label={column.label}
                    columnKey={column.key}
                    sortDesc={column.sortDesc}
                    currentKey={sortKey}
                    direction={direction}
                    onToggle={toggle}
                    help={getColumnHelp(column.key, t)}
                    align="center"
                    tooltipAnchor={index === columns.length - 1 ? 'end' : 'center'}
                    ariaSortAsc={sortAscLabel}
                    ariaSortDesc={sortDescLabel}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((row) => (
              <tr key={row.registrationId} className="border-b border-border last:border-0">
                <td className="px-4 py-2 text-center font-semibold">{row.rank}</td>
                <td className="px-4 py-2">
                  <span className="font-medium text-foreground">{row.displayName}</span>
                  {row.club && (
                    <span className="ml-2 text-xs text-muted">
                      {row.club.abbreviation ?? row.club.name}
                    </span>
                  )}
                  {row.withdrawn && (
                    // Their played results still count — for them and for every
                    // opponent's Buchholz. The pill says "not in later rounds",
                    // not "removed".
                    <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
                      {t('organizer.swiss.standings.withdrawn', {
                        round: row.withdrawnAtRound ?? 0,
                      })}
                    </span>
                  )}
                </td>
                {columns.map((column) => (
                  <td key={column.key} className="px-4 py-2 text-center">
                    {formatStat(column, row.stats[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatStat(column: StandingsColumn, value: unknown): string {
  if (value == null || value === '') return '—';
  if (column.decimals != null) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed.toFixed(column.decimals);
  }
  return String(value);
}

function downloadCsv(data: SwissStandings) {
  const headers = ['Rank', 'Fighter', 'Club', ...data.columns.map((c) => c.label), 'Withdrawn'];
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of data.rows) {
    lines.push(
      [
        String(row.rank),
        row.displayName,
        row.club?.name ?? '',
        ...data.columns.map((c) => formatStat(c, row.stats[c.key])),
        row.withdrawn ? String(row.withdrawnAtRound ?? '') : '',
      ]
        .map(escapeCsvCell)
        .join(','),
    );
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = 'swiss-standings.csv';
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}
