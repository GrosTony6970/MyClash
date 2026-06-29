'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface StandingsColumn {
  key: string;
  label: string;
  type: 'number' | 'string';
  sortDesc?: boolean;
  /** Fixed decimal places for display (e.g. 2 for the ratio score → "4.00"). */
  decimals?: number;
}

/** Render a stat cell, applying the column's fixed decimal places when set. */
function formatStat(c: StandingsColumn, value: unknown, empty: string): string {
  if (value == null || value === '') return empty;
  if (c.decimals != null) {
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(n)) return n.toFixed(c.decimals);
  }
  return String(value);
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

export function StandingsTab({ tournamentId, poolPhaseId }: StandingsTabProps) {
  const [mode, setMode] = useState<Mode>('overall');
  const [overall, setOverall] = useState<OverallResponse | null>(null);
  const [byPool, setByPool] = useState<ByPoolResponse | null>(null);
  // Stale-while-revalidate: keep showing the cached payload while
  // a refetch (poll / realtime event / manual button / mode switch)
  // runs in the background. The full-page "Loading…" placeholder
  // only shows when there's no cached data yet for the current mode.
  const [revalidating, setRevalidating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // Bracket size (when a bracket exists) → drives the qualification cut line in
  // the overall standings: the top `bracketSize` fighters make the bracket.
  const [bracketSize, setBracketSize] = useState<number | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs mode from the URL hash on mount and on hashchange
    setMode(readHashMode());
    function onHash() {
      setMode(readHashMode());
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch lifecycle: revalidating flag toggled before the network request resolves
    setRevalidating(true);
    const url = `${apiUrl}/api/v1/tournaments/${tournamentId}/pool-standings?mode=${mode}`;
    void fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (mode === 'overall') setOverall(data as OverallResponse);
        else setByPool(data as ByPoolResponse);
      })
      .finally(() => setRevalidating(false));
  }, [tournamentId, mode, refreshKey]);

  // Fetch the bracket size (if a bracket has been generated) so the overall
  // standings can draw the qualification cut line after the Nth fighter.
  useEffect(() => {
    let cancelled = false;
    void fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/bracket`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { bracketSize?: number; mainBracketSize?: number } | null) => {
        if (cancelled) return;
        const size = data?.bracketSize ?? data?.mainBracketSize ?? null;
        setBracketSize(typeof size === 'number' && size > 0 ? size : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tournamentId, refreshKey]);

  const hasDataForMode = mode === 'overall' ? overall !== null : byPool !== null;

  useRealtimeWithFallback({
    channelName: `pool-standings-${tournamentId}-${mode}`,
    table: 'matches',
    filter: `phase_id=eq.${poolPhaseId}`,
    event: '*',
    onEvent: refresh,
    onFallbackPoll: refresh,
    fallbackPollMs: 30_000,
  });

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
        ...columns.map((c) => formatStat(c, row.stats[c.key], '')),
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
        <div className="inline-flex gap-1 rounded-md border border-border bg-surface p-1">
          <button
            type="button"
            onClick={() => selectMode('overall')}
            className={`rounded px-3 py-1 text-sm font-medium ${
              mode === 'overall'
                ? 'bg-accent text-accent-foreground'
                : 'text-foreground-secondary hover:bg-background'
            }`}
          >
            {t('organizer.pools.standings.overall')}
          </button>
          <button
            type="button"
            onClick={() => selectMode('by-pool')}
            className={`rounded px-3 py-1 text-sm font-medium ${
              mode === 'by-pool'
                ? 'bg-accent text-accent-foreground'
                : 'text-foreground-secondary hover:bg-background'
            }`}
          >
            {t('organizer.pools.standings.byPool')}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {revalidating && hasDataForMode && (
            <span className="text-xs italic text-muted">{t('common.refreshing')}</span>
          )}
          <button
            type="button"
            onClick={refresh}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background"
          >
            {t('actions.refresh')}
          </button>

          {mode === 'overall' && overall && overall.rows.length > 0 && (
            <button
              type="button"
              onClick={() => downloadCsv(overall.columns, overall.rows, 'overall-standings.csv')}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background"
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
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background"
            >
              {t('organizer.pools.standings.exportAllPools')}
            </button>
          )}
        </div>
      </div>

      {!hasDataForMode && <p className="text-sm text-muted">{t('common.loading')}</p>}

      {hasDataForMode &&
        mode === 'overall' &&
        overall &&
        (overall.rows.length === 0 ? (
          <EmptyState />
        ) : (
          <StandingsTable
            columns={overall.columns}
            rows={overall.rows}
            cutAfterIndex={bracketSize}
          />
        ))}

      {hasDataForMode &&
        mode === 'by-pool' &&
        byPool &&
        (byPool.pools.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-6">
            {byPool.pools.map((pool) => (
              <section
                key={pool.poolId}
                className="overflow-hidden rounded-lg border border-border bg-surface"
              >
                <header className="flex items-center justify-between border-b border-border px-4 py-3">
                  <h3 className="font-display font-semibold text-lg sm:text-xl text-foreground">
                    {pool.poolName}
                  </h3>
                  {pool.rows.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        downloadCsv(byPool.columns, pool.rows, `${pool.poolName}-standings.csv`)
                      }
                      className="text-xs text-foreground-secondary hover:underline"
                    >
                      {t('organizer.pools.standings.exportPool')}
                    </button>
                  )}
                </header>
                {pool.rows.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted">
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

function StandingsTable({
  columns,
  rows,
  cutAfterIndex,
}: {
  columns: StandingsColumn[];
  rows: StandingsRow[];
  /** Draw a qualification cut line after this many fighters (= bracket size).
   *  Only meaningful in the overall ranking; omitted in by-pool mode. */
  cutAfterIndex?: number | null;
}) {
  // Surface the ranking metric (score) first and make it stand out — it's the
  // column the standings are actually ordered by.
  const orderedColumns = [
    ...columns.filter((c) => c.key === 'score'),
    ...columns.filter((c) => c.key !== 'score'),
  ];
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-border bg-background text-left text-xs uppercase tracking-wide text-muted">
        <tr>
          <th className="w-16 px-4 py-2 text-center">{t('organizer.pools.standings.rank')}</th>
          <th className="px-4 py-2">{t('organizer.pools.standings.fighter')}</th>
          {orderedColumns.map((c) => (
            <th
              key={c.key}
              className={
                c.key === 'score'
                  ? 'bg-accent/10 px-4 py-2 text-center text-sm font-bold normal-case tracking-normal text-accent'
                  : 'px-4 py-2 text-center'
              }
            >
              {c.label}
            </th>
          ))}
          <th className="px-4 py-2">{t('organizer.pools.standings.status')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          // Qualification cutoff: a black line below the Nth fighter (N =
          // bracket size). Skip it when everyone qualifies (cut at/after the
          // last row).
          const isCut = cutAfterIndex != null && idx === cutAfterIndex - 1 && idx < rows.length - 1;
          return (
            <tr
              key={row.registrationId}
              className={`${
                isCut ? 'border-b-2 border-foreground' : 'border-b border-border'
              } last:border-0 hover:bg-background`}
            >
              <td className="px-4 py-2 text-center font-mono tabular-nums text-foreground-secondary">
                {row.rank}
              </td>
              <td className="px-4 py-2">
                <span className="font-medium text-foreground">{row.displayName}</span>
                {row.club && (
                  <span className="ml-2 rounded bg-border px-1.5 py-0.5 text-xs text-foreground-secondary">
                    {row.club.abbreviation ?? row.club.name}
                  </span>
                )}
              </td>
              {orderedColumns.map((c) => (
                <td
                  key={c.key}
                  className={
                    c.key === 'score'
                      ? 'bg-accent/5 px-4 py-2 text-center font-mono text-base font-bold tabular-nums text-foreground'
                      : 'px-4 py-2 text-center font-mono tabular-nums text-foreground-secondary'
                  }
                >
                  {formatStat(c, row.stats[c.key], '—')}
                </td>
              ))}
              <td className="px-4 py-2">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    row.status === 'completed'
                      ? 'bg-success/10 text-success'
                      : 'bg-border text-foreground-secondary'
                  }`}
                >
                  {row.status}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
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
