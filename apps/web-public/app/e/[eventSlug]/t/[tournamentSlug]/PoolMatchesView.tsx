'use client';

/* eslint-disable myclash/no-literal-string -- pre-i18n public page (matches the other public tournament tabs). */

/**
 * PoolMatchesView — read-only matches table per pool, surfaced on the
 * public tournament page's new "Pool Matches" tab. Mirrors the admin
 * MatchesTab but without the mutation pickers (Apply-to widgets,
 * lice / referee dropdowns) — spectators only need to read.
 *
 * Columns: Round | Red fighter | Score | Score | Blue fighter |
 * Status | Lice. Per-match referee chips are intentionally NOT shown
 * here — those still surface on the Pool List card footer.
 *
 * Live updates: realtime on `exchanges` filtered by pool_id triggers
 * a refetch of the whole projection. Same pattern as StandingsView.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sideStyle, tintTextClassFor } from '@myclash/ui';
import { DEFAULT_SCORING_CONFIG, type TournamentSideColor } from '@myclash/types';
import { t } from '@myclash/i18n';
import { formatInZone } from '@myclash/time';
import { supabase } from '@/lib/supabase';
import { getApiUrl } from '@/lib/api-url';
import { naturalCompare } from './pool-matches-sort';
import { matchesQuery } from './pool-matches-filter';
import { poolMatchWinner } from './pool-match-winner';

interface PoolMatch {
  matchId: string;
  roundCode: string;
  status: string;
  scheduledAt: string | null;
  redFighterName: string | null;
  redClubAbbrev: string | null;
  redScore: number | null;
  blueFighterName: string | null;
  blueClubAbbrev: string | null;
  blueScore: number | null;
  liceName: string | null;
  liceColorHex: string | null;
}

interface PoolWithMatches {
  poolId: string;
  poolName: string;
  matches: PoolMatch[];
}

interface SideColors {
  red: TournamentSideColor;
  blue: TournamentSideColor;
}

interface ApiResponse {
  tournamentId: string;
  /** Configured fighter-side colour tokens (default red/blue), resolved to
   *  hex via `sideStyle` for the accent bar — matches the admin matches table. */
  sideColors: SideColors;
  /** Event IANA timezone — pool schedule times render in it. */
  timezone?: string;
  pools: PoolWithMatches[];
}

/** The pool's scheduled date/time = its earliest match start. */
function poolScheduledStart(pool: PoolWithMatches): string | null {
  const starts = pool.matches
    .map((m) => m.scheduledAt)
    .filter((v): v is string => Boolean(v))
    .sort();
  return starts[0] ?? null;
}

const DEFAULT_SIDE_COLORS: SideColors = { red: 'red', blue: 'blue' };

interface Props {
  eventSlug: string;
  tournamentSlug: string;
  /** Optional tournament brand color token for the section title. */
  colorToken?: string | null;
}

/** Pool id deep-linked from the Pool List tab (`#poolmatches/<poolId>`). */
function parseFocusPoolId(hash: string): string | null {
  const [base, sub] = hash.replace(/^#/, '').split('/');
  return base === 'poolmatches' && sub ? sub : null;
}

export function PoolMatchesView({ eventSlug, tournamentSlug, colorToken }: Props) {
  const router = useRouter();
  const [pools, setPools] = useState<PoolWithMatches[]>([]);
  const [sideColors, setSideColors] = useState<SideColors>(DEFAULT_SIDE_COLORS);
  const [timezone, setTimezone] = useState('Europe/Paris');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState('');
  // Pool deep-link focus: a pool card on the #pools tab links to
  // `#poolmatches/<poolId>`; we scroll to + briefly highlight that pool.
  // Lazy init reads the hash on mount; the hashchange listener (a callback,
  // not the effect body) handles later changes — keeps the effect side-effect
  // only (no setState-in-effect).
  const [focusPoolId, setFocusPoolId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : parseFocusPoolId(window.location.hash),
  );

  const titleClass = colorToken ? tintTextClassFor(colorToken) : 'text-slate-900';
  // Resolve the configured side-colour tokens to hex for the accent bars,
  // the same way the admin matches table does.
  const sideConfig = {
    ...DEFAULT_SCORING_CONFIG,
    display: { ...DEFAULT_SCORING_CONFIG.display, sideColors },
  };

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    // Resolve the API base URL client-side: getApiUrl() returns the
    // public NEXT_PUBLIC_API_URL in the browser. A server-passed prop
    // would carry the docker-internal http://api:4000, which is
    // unreachable from the browser (the bug that left this tab empty).
    const apiUrl = getApiUrl();
    void fetch(
      `${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}/tournaments/${encodeURIComponent(
        tournamentSlug,
      )}/pools-with-matches`,
      { cache: 'no-store', signal: controller.signal },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          const res = data as ApiResponse;
          setPools(res.pools);
          if (res.sideColors) setSideColors(res.sideColors);
          if (res.timezone) setTimezone(res.timezone);
        }
      })
      .catch(() => {
        // Swallow — keep showing last-known pools.
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [eventSlug, tournamentSlug, refreshKey]);

  // Realtime: any exchange on this tournament's pool matches
  // triggers a refetch. We subscribe by pool ids so the channel
  // doesn't drift across tournaments.
  useEffect(() => {
    const poolIds = pools.map((p) => p.poolId);
    if (poolIds.length === 0) return;
    const channel = supabase
      .channel(`pool-matches-${tournamentSlug}`)
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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
          filter: `pool_id=in.(${poolIds.join(',')})`,
        },
        refresh,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [pools, tournamentSlug, refresh]);

  // A click from the Pool List tab changes the hash — update the focus.
  useEffect(() => {
    const onHash = () => setFocusPoolId(parseFocusPoolId(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Scroll the focused pool into view + briefly highlight it. DOM-only (no
  // React state) so this is a pure side effect; rAF defers the scroll until
  // the (previously hidden) tab panel is laid out. The transient ring uses an
  // inline box-shadow so it can't be purged from the Tailwind build.
  useEffect(() => {
    if (!focusPoolId || pools.length === 0) return;
    const el = document.getElementById(`pool-${focusPoolId}`);
    if (!el) return;
    const raf = requestAnimationFrame(() =>
      el.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
    el.style.boxShadow = '0 0 0 2px #f59e0b, 0 0 0 6px rgba(245,158,11,0.25)';
    const timer = setTimeout(() => {
      el.style.boxShadow = '';
    }, 2000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      el.style.boxShadow = '';
    };
  }, [focusPoolId, pools]);

  if (loading && pools.length === 0) {
    return <p className="text-sm italic text-slate-500">Loading…</p>;
  }
  if (pools.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-stone-300 bg-stone-100 p-6 text-center text-sm text-slate-500">
        Pool matches will be published once the organizer generates the schedule.
      </p>
    );
  }

  // Natural-sort each pool's matches (M1, M2, … M10) then apply the
  // search filter. When a query is active, drop pools left with no
  // matching rows so the results collapse to what's relevant.
  const q = query.trim();
  const displayPools = pools
    .map((pool) => ({
      ...pool,
      matches: [...pool.matches]
        .sort((a, b) => naturalCompare(a.roundCode, b.roundCode))
        .filter((m) => matchesQuery(m, query)),
    }))
    .filter((pool) => (q ? pool.matches.length > 0 : true));

  return (
    <div className="flex flex-col gap-6">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('publicApp.tournament.poolMatchesSearch')}
        className="w-full rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-200"
      />

      {q && displayPools.length === 0 && (
        <p className="rounded-xl border border-dashed border-stone-300 bg-stone-100 p-6 text-center text-sm text-slate-500">
          {t('publicApp.tournament.poolMatchesNoResults')}
        </p>
      )}

      {displayPools.map((pool) => (
        <article
          key={pool.poolId}
          id={`pool-${pool.poolId}`}
          className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition-shadow"
        >
          <header className="flex items-baseline justify-between gap-3 border-b border-stone-100 px-4 py-3">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h3 className={`font-display text-lg font-semibold sm:text-xl ${titleClass}`}>
                {pool.poolName}
              </h3>
              {(() => {
                const start = poolScheduledStart(pool);
                return start ? (
                  <span className="text-xs font-medium text-slate-500">
                    {formatInZone(start, timezone, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                ) : null;
              })()}
            </div>
            <span className="shrink-0 text-xs uppercase tracking-wider text-slate-500">
              {pool.matches.length} matches
            </span>
          </header>
          {pool.matches.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm italic text-slate-500">No matches yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-stone-100 bg-stone-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="w-32 px-4 py-2">Round</th>
                    <th className="px-4 py-2">Fighter 1</th>
                    <th className="w-12 px-2 py-2 text-center">Pts</th>
                    <th className="w-12 px-2 py-2 text-center">Pts</th>
                    <th className="px-4 py-2">Fighter 2</th>
                    <th className="w-24 px-4 py-2">Status</th>
                    <th className="w-32 px-4 py-2">Lice</th>
                  </tr>
                </thead>
                <tbody>
                  {pool.matches.map((m) => {
                    const openMatch = () => router.push(`/e/${eventSlug}/match/${m.matchId}`);
                    const winner = poolMatchWinner(m);
                    return (
                      <tr
                        key={m.matchId}
                        role="link"
                        tabIndex={0}
                        onClick={openMatch}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openMatch();
                          }
                        }}
                        className="cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50 focus:bg-stone-50 focus:outline-none"
                      >
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">
                          {m.roundCode}
                        </td>
                        <td className="px-4 py-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className="h-6 w-1 shrink-0 rounded"
                              style={{ backgroundColor: sideStyle(sideConfig, 'red').border }}
                              aria-hidden="true"
                            />
                            <span
                              className={
                                winner === 'red'
                                  ? 'font-bold text-slate-900'
                                  : 'font-medium text-slate-900'
                              }
                            >
                              {m.redFighterName ?? '—'}
                            </span>
                            {m.redClubAbbrev && (
                              <span className="max-w-[10rem] truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                                {m.redClubAbbrev}
                              </span>
                            )}
                          </span>
                        </td>
                        <td
                          className={`px-2 py-2 text-center font-mono ${
                            winner === 'red' ? 'font-bold text-slate-900' : ''
                          }`}
                        >
                          {m.redScore ?? '—'}
                        </td>
                        <td
                          className={`px-2 py-2 text-center font-mono ${
                            winner === 'blue' ? 'font-bold text-slate-900' : ''
                          }`}
                        >
                          {m.blueScore ?? '—'}
                        </td>
                        <td className="px-4 py-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className="h-6 w-1 shrink-0 rounded"
                              style={{ backgroundColor: sideStyle(sideConfig, 'blue').border }}
                              aria-hidden="true"
                            />
                            <span
                              className={
                                winner === 'blue'
                                  ? 'font-bold text-slate-900'
                                  : 'font-medium text-slate-900'
                              }
                            >
                              {m.blueFighterName ?? '—'}
                            </span>
                            {m.blueClubAbbrev && (
                              <span className="max-w-[10rem] truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                                {m.blueClubAbbrev}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <StatusPill status={m.status} />
                        </td>
                        <td className="px-4 py-2">
                          {m.liceName ? (
                            <span className="inline-flex items-center gap-1.5">
                              {m.liceColorHex && (
                                <span
                                  aria-hidden="true"
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: m.liceColorHex }}
                                />
                              )}
                              <span className="text-xs text-slate-600">{m.liceName}</span>
                            </span>
                          ) : (
                            <span className="text-xs italic text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const classes =
    status === 'completed'
      ? 'bg-emerald-100 text-emerald-700'
      : status === 'running'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-stone-100 text-slate-600';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}>
      {status}
    </span>
  );
}
