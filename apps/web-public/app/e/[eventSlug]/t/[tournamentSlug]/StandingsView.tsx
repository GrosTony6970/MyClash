'use client';

/**
 * StandingsView — Overall / Per pool sub-tabs for the public tournament
 * standings tab. Mirrors the admin pattern (hash mode + segmented
 * toggle), but read-only and themed by the tournament color.
 *
 * Default landing is `#standings` → Overall (one table with every
 * fighter, ranked across the whole tournament's pool phase). The
 * second toggle `#standings-by-pool` renders one card per pool,
 * reusing the existing public `StandingsTable` component verbatim.
 *
 * The Overall payload comes from the existing public-ready endpoint
 * `GET /api/v1/tournaments/:tournamentId/pool-standings?mode=overall`.
 * Live updates: realtime on `exchanges` filtered to the tournament
 * triggers a refetch.
 */

import { useCallback, useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { accentClassFor } from '@myclash/ui';
import { supabase } from '@/lib/supabase';
import { getApiUrl } from '@/lib/api-url';
import { StandingsTable } from './StandingsTable';
import type { Pool } from './page';

type Mode = 'overall' | 'by-pool';

interface OverallColumn {
  key: string;
  label: string;
  type: 'number' | 'string';
  sortDesc?: boolean;
}

interface OverallRow {
  rank: number;
  registrationId: string;
  displayName: string;
  club: { id: string; name: string; abbreviation: string | null } | null;
  status: string;
  stats: Record<string, number | string>;
}

interface OverallResponse {
  rulesetCode: string;
  rulesetVersion: string;
  columns: OverallColumn[];
  rows: OverallRow[];
}

interface Props {
  tournamentId: string;
  pools: Pool[];
  /** Optional tournament brand color token for the active toggle pill. */
  colorToken?: string | null;
}

function readHashMode(): Mode {
  if (typeof window === 'undefined') return 'overall';
  const hash = window.location.hash.replace('#', '');
  return hash === 'standings-by-pool' ? 'by-pool' : 'overall';
}

export function StandingsView({ tournamentId, pools, colorToken }: Props) {
  const [mode, setMode] = useState<Mode>('overall');
  const [overall, setOverall] = useState<OverallResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Active toggle pill matches the tournament's brand color. Falls
  // back to red-800 for tournaments without one (preserves the
  // legacy look).
  const activePillClass = colorToken
    ? `${accentClassFor(colorToken)} text-white`
    : 'bg-red-800 text-white';

  // Sync hash → mode on mount + browser back/forward.
  useEffect(() => {
    setMode(readHashMode());
    function onHash() {
      setMode(readHashMode());
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Fetch overall standings when the mode is `overall` (or on refresh).
  useEffect(() => {
    if (mode !== 'overall') return;
    const controller = new AbortController();
    // Resolve client-side: getApiUrl() returns the browser-reachable
    // public URL. A server-passed prop would be the docker-internal
    // host, unreachable from the browser.
    const apiUrl = getApiUrl();
    void fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/pool-standings?mode=overall`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setOverall(data as OverallResponse);
      })
      .catch(() => {
        // Swallow — stale data is better than a stack trace on a
        // spectator page.
      });
    return () => controller.abort();
  }, [tournamentId, mode, refreshKey]);

  // Realtime refresh: subscribe to `exchanges` scoped to the
  // tournament's pool ids. Per-pool StandingsTable instances have
  // their own subscriptions for the by-pool view; this hook drives
  // refetch for the overall table only.
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  useEffect(() => {
    const poolIds = pools.map((p) => p.id);
    if (poolIds.length === 0) return;
    const channel = supabase
      .channel(`pool-standings-overall-${tournamentId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'exchanges',
          filter: `pool_id=in.(${poolIds.join(',')})`,
        },
        refresh,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tournamentId, pools, refresh]);

  function selectMode(next: Mode) {
    if (typeof window !== 'undefined') {
      window.location.hash = next === 'overall' ? '#standings' : '#standings-by-pool';
    }
    setMode(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="inline-flex w-fit gap-1 rounded-md border border-stone-200 bg-white p-1">
        <button
          type="button"
          onClick={() => selectMode('overall')}
          className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
            mode === 'overall' ? activePillClass : 'text-slate-700 hover:bg-stone-50'
          }`}
        >
          {t('publicApp.tournament.standings.modeOverall')}
        </button>
        <button
          type="button"
          onClick={() => selectMode('by-pool')}
          className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
            mode === 'by-pool' ? activePillClass : 'text-slate-700 hover:bg-stone-50'
          }`}
        >
          {t('publicApp.tournament.standings.modeByPool')}
        </button>
      </div>

      {mode === 'overall' ? (
        <OverallTable data={overall} />
      ) : (
        <div className="flex flex-col gap-6">
          {pools.map((pool) => (
            <StandingsTable
              key={pool.id}
              poolId={pool.id}
              poolName={pool.name}
              initialStandings={pool.standings}
              tournamentId={tournamentId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OverallTable({ data }: { data: OverallResponse | null }) {
  if (!data) {
    return (
      <p className="rounded-xl border border-dashed border-stone-300 bg-stone-100 p-6 text-center text-sm text-slate-500">
        Loading…
      </p>
    );
  }
  if (data.rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-stone-300 bg-stone-100 p-6 text-center text-sm text-slate-500">
        No standings yet. Results will appear once pool matches are completed.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-xs uppercase tracking-wider text-slate-500">
            <th className="w-12 py-2 pr-3 text-center font-semibold">#</th>
            <th className="py-2 pr-3 text-left font-semibold">Fighter</th>
            {data.columns.map((c) => (
              <th key={c.key} className="px-2 py-2 text-right font-semibold">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, idx) => (
            <tr
              key={row.registrationId}
              className={[
                'border-b border-stone-100',
                idx === 0 ? 'text-slate-900' : 'text-slate-700',
              ].join(' ')}
            >
              <td className="py-2 pr-3 text-center font-mono">{row.rank}</td>
              <td className="py-2 pr-3">
                <p className="font-medium leading-tight">{row.displayName}</p>
                {row.club && (
                  <p className="text-xs text-slate-500">{row.club.abbreviation ?? row.club.name}</p>
                )}
              </td>
              {data.columns.map((c) => (
                <td key={c.key} className="px-2 py-2 text-right font-mono">
                  {row.stats[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
