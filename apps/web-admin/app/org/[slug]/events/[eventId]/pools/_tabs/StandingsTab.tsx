'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '@myclash/i18n';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface StandingsColumn {
  key: string;
  label: string;
  type: 'number' | 'string';
  sortDesc?: boolean;
}

interface StandingsRow {
  rank: number;
  registrationId: string;
  displayName: string;
  club: { id: string; name: string; abbreviation: string | null } | null;
  status: 'in_progress' | 'completed';
  stats: Record<string, number | string>;
}

interface OverallResponse {
  rulesetCode: string;
  rulesetVersion: string;
  columns: StandingsColumn[];
  rows: StandingsRow[];
}

interface ByPoolResponse {
  rulesetCode: string;
  rulesetVersion: string;
  columns: StandingsColumn[];
  pools: Array<{
    poolId: string;
    poolName: string;
    status: 'in_progress' | 'completed';
    rows: StandingsRow[];
  }>;
}

type Mode = 'overall' | 'by-pool';

interface StandingsTabProps {
  tournamentId: string;
  poolPhaseId: string;
}

function readHashMode(): Mode {
  if (typeof window === 'undefined') return 'overall';
  const hash = window.location.hash.replace('#', '');
  if (hash === 'standings-by-pool') return 'by-pool';
  return 'overall';
}

export function StandingsTab({ tournamentId }: StandingsTabProps) {
  const [mode, setMode] = useState<Mode>('overall');
  const [overall, setOverall] = useState<OverallResponse | null>(null);
  const [byPool, setByPool] = useState<ByPoolResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    setMode(readHashMode());
    function onHash() {
      setMode(readHashMode());
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    setLoading(true);
    const url = `${apiUrl}/api/v1/tournaments/${tournamentId}/pool-standings?mode=${mode}`;
    void fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (mode === 'overall') setOverall(data as OverallResponse);
        else setByPool(data as ByPoolResponse);
        setLoading(false);
      });
  }, [tournamentId, mode, refreshKey]);

  function selectMode(m: Mode) {
    window.location.hash = m === 'overall' ? '#standings-overall' : '#standings-by-pool';
    setMode(m);
  }

  function downloadCsv(
    columns: StandingsColumn[],
    rows: Array<StandingsRow & { _poolName?: string }>,
    filename: string,
    includePool?: boolean,
  ) {
    const headers = [
      'Rank',
      'Fighter',
      'Club',
      ...(includePool ? ['Pool'] : []),
      ...columns.map((c) => c.label),
      'Status',
    ];
    const lines = [headers.map(csvEscape).join(',')];
    for (const row of rows) {
      const r: string[] = [
        String(row.rank),
        row.displayName,
        row.club?.name ?? '',
        ...(includePool ? [row._poolName ?? ''] : []),
        ...columns.map((c) => String(row.stats[c.key] ?? '')),
        row.status,
      ];
      lines.push(r.map(csvEscape).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="inline-flex gap-1 rounded-md border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => selectMode('overall')}
            className={`rounded px-3 py-1 text-sm font-medium ${
              mode === 'overall' ? 'bg-red-800 text-white' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t('organizer.pools.standings.overall')}
          </button>
          <button
            type="button"
            onClick={() => selectMode('by-pool')}
            className={`rounded px-3 py-1 text-sm font-medium ${
              mode === 'by-pool' ? 'bg-red-800 text-white' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t('organizer.pools.standings.byPool')}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {t('actions.refresh')}
          </button>

          {mode === 'overall' && overall && overall.rows.length > 0 && (
            <button
              type="button"
              onClick={() => downloadCsv(overall.columns, overall.rows, 'overall-standings.csv')}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t('organizer.pools.standings.exportCsv')}
            </button>
          )}
          {mode === 'by-pool' && byPool && byPool.pools.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const allRows = byPool.pools.flatMap((p) =>
                  p.rows.map((r) => ({ ...r, _poolName: p.poolName })),
                );
                downloadCsv(byPool.columns, allRows, 'all-pools-standings.csv', true);
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t('organizer.pools.standings.exportAllPools')}
            </button>
          )}
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}

      {!loading &&
        mode === 'overall' &&
        overall &&
        (overall.rows.length === 0 ? (
          <EmptyState />
        ) : (
          <StandingsTable columns={overall.columns} rows={overall.rows} />
        ))}

      {!loading &&
        mode === 'by-pool' &&
        byPool &&
        (byPool.pools.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-6">
            {byPool.pools.map((pool) => (
              <section
                key={pool.poolId}
                className="overflow-hidden rounded-lg border border-slate-200 bg-white"
              >
                <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h3 className="font-semibold text-slate-900">{pool.poolName}</h3>
                  {pool.rows.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        downloadCsv(byPool.columns, pool.rows, `${pool.poolName}-standings.csv`)
                      }
                      className="text-xs text-slate-600 hover:underline"
                    >
                      {t('organizer.pools.standings.exportPool')}
                    </button>
                  )}
                </header>
                {pool.rows.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-slate-400">
                    {t('organizer.pools.standings.emptyPool')}
                  </p>
                ) : (
                  <StandingsTable columns={byPool.columns} rows={pool.rows} />
                )}
              </section>
            ))}
          </div>
        ))}
    </div>
  );
}

function StandingsTable({ columns, rows }: { columns: StandingsColumn[]; rows: StandingsRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="w-16 px-4 py-2">{t('organizer.pools.standings.rank')}</th>
          <th className="px-4 py-2">{t('organizer.pools.standings.fighter')}</th>
          {columns.map((c) => (
            <th key={c.key} className="px-4 py-2 text-right">
              {c.label}
            </th>
          ))}
          <th className="px-4 py-2">{t('organizer.pools.standings.status')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.registrationId}
            className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
          >
            <td className="px-4 py-2 font-mono text-slate-700">{row.rank}</td>
            <td className="px-4 py-2">
              <span className="font-medium text-slate-900">{row.displayName}</span>
              {row.club && (
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                  {row.club.abbreviation ?? row.club.name}
                </span>
              )}
            </td>
            {columns.map((c) => (
              <td key={c.key} className="px-4 py-2 text-right font-mono text-slate-700">
                {row.stats[c.key] ?? '—'}
              </td>
            ))}
            <td className="px-4 py-2">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                  row.status === 'completed'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {row.status}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
      {t('organizer.pools.standings.noMatchesYet')}
    </div>
  );
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
