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

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
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
  /** Fixed decimal places for display (e.g. 2 for the ratio score → "4.00"). */
  decimals?: number;
}

/** Render a stat cell, applying the column's fixed decimal places when set. */
function formatStat(c: OverallColumn, value: unknown): string {
  if (value == null || value === '') return '—';
  if (c.decimals != null) {
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(n)) return n.toFixed(c.decimals);
  }
  return String(value);
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
  /**
   * Bracket size (e.g. 16) — the qualification cutoff. The Overall table draws
   * a thick rule under fighter #N to separate who qualified for the bracket,
   * mirroring the admin standings.
   */
  bracketSize?: number | null;
  /** Optional tournament brand color token for the active toggle pill. */
  colorToken?: string | null;
  /** Personal space: mark the viewer's own row with a "YOU" chip. */
  highlightRegistrationId?: string | null;
}

/** Personal-space "YOU" chip marking the viewer's own row. */
function YouChip({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded bg-accent px-1 py-px text-[9px] font-bold uppercase leading-none text-accent-foreground">
      {label}
    </span>
  );
}

function readHashMode(): Mode {
  if (typeof window === 'undefined') return 'overall';
  const hash = window.location.hash.replace('#', '');
  return hash === 'standings-by-pool' ? 'by-pool' : 'overall';
}

/** Subscribe a useSyncExternalStore consumer to URL-hash changes. */
function subscribeHash(onStoreChange: () => void): () => void {
  window.addEventListener('hashchange', onStoreChange);
  return () => window.removeEventListener('hashchange', onStoreChange);
}

export function StandingsView({
  tournamentId,
  pools,
  bracketSize,
  colorToken,
  highlightRegistrationId,
}: Props) {
  // Mode is derived from the URL hash via useSyncExternalStore — the
  // SSR-safe, lint-clean way to read an external mutable source. The server
  // snapshot is always 'overall' (matches the SSR HTML); after hydration the
  // client snapshot reads the real hash, so there's no hydration mismatch AND
  // no setState-in-effect (which the old mount effect tripped).
  const mode = useSyncExternalStore(subscribeHash, readHashMode, () => 'overall');
  const [overall, setOverall] = useState<OverallResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Active toggle pill matches the tournament's brand color. Falls
  // back to red-800 for tournaments without one (preserves the
  // legacy look).
  const activePillClass = colorToken
    ? `${accentClassFor(colorToken)} text-white`
    : 'bg-red-800 text-white';

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
    // Writing the hash fires `hashchange`, which the useSyncExternalStore
    // subscription picks up → `mode` re-derives. No explicit setState needed.
    if (typeof window !== 'undefined') {
      window.location.hash = next === 'overall' ? '#standings' : '#standings-by-pool';
    }
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
        <OverallTable
          data={overall}
          bracketSize={bracketSize ?? null}
          highlightRegistrationId={highlightRegistrationId}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {pools.map((pool) => (
            <StandingsTable
              key={pool.id}
              poolId={pool.id}
              poolName={pool.name}
              initialStandings={pool.standings}
              tournamentId={tournamentId}
              highlightRegistrationId={highlightRegistrationId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OverallTable({
  data,
  bracketSize,
  highlightRegistrationId,
}: {
  data: OverallResponse | null;
  bracketSize: number | null;
  highlightRegistrationId?: string | null;
}) {
  if (!data) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted">
        {t('publicApp.tournament.loading')}
      </p>
    );
  }
  if (data.rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted">
        {t('publicApp.tournament.standings.emptyOverall')}
      </p>
    );
  }
  // Score column moves first and is highlighted — mirrors the admin standings,
  // where the ranking score is the headline stat.
  const orderedColumns = [
    ...data.columns.filter((c) => c.key === 'score'),
    ...data.columns.filter((c) => c.key !== 'score'),
  ];
  // The qualification cut line sits under fighter #N (N = bracket size) when
  // there are fighters below it — the visual "made the bracket" boundary.
  const cutAfterIndex = bracketSize != null && bracketSize > 0 ? bracketSize : null;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-background text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="w-12 px-3 py-2 text-center font-semibold">#</th>
            <th className="px-3 py-2 text-left font-semibold">
              {t('publicApp.tournament.standings.colFighter')}
            </th>
            {orderedColumns.map((c) => (
              <th
                key={c.key}
                className={
                  c.key === 'score'
                    ? 'bg-accent/10 px-3 py-2 text-center text-sm font-bold normal-case tracking-normal text-accent'
                    : 'px-2 py-2 text-right font-semibold'
                }
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, idx) => {
            const isCut =
              cutAfterIndex != null && idx === cutAfterIndex - 1 && idx < data.rows.length - 1;
            const isYou =
              !!highlightRegistrationId && row.registrationId === highlightRegistrationId;
            return (
              <tr
                key={row.registrationId}
                className={[
                  isCut ? 'border-b-2 border-foreground' : 'border-b border-border',
                  'last:border-0',
                  isYou ? 'bg-accent/5' : '',
                  idx === 0 ? 'text-foreground' : 'text-foreground-secondary',
                ].join(' ')}
              >
                <td className="px-3 py-2 text-center font-mono tabular-nums">{row.rank}</td>
                <td className="px-3 py-2">
                  <p
                    className={[
                      'flex items-center gap-1 font-medium leading-tight',
                      isYou ? 'font-bold text-accent' : 'text-foreground',
                    ].join(' ')}
                  >
                    {row.displayName}
                    {isYou && <YouChip label={t('publicApp.me.hub.youChip')} />}
                  </p>
                  {row.club && (
                    <p className="text-xs text-muted">{row.club.abbreviation ?? row.club.name}</p>
                  )}
                </td>
                {orderedColumns.map((c) => (
                  <td
                    key={c.key}
                    className={
                      c.key === 'score'
                        ? 'bg-accent/5 px-3 py-2 text-center font-mono text-base font-bold tabular-nums text-foreground'
                        : 'px-2 py-2 text-right font-mono tabular-nums'
                    }
                  >
                    {formatStat(c, row.stats[c.key])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
