'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { t } from '@myclash/i18n';
import { formatRoundCode } from '@myclash/types';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { accentClassFor, type ColorToken } from '@myclash/ui';
import { mergeScores, type MatchScoreUpdate } from './match-scores-merge';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface MatchRow {
  id: string;
  pool_id: string;
  round_number: number;
  red_registration_id: string;
  blue_registration_id: string;
  red_name: string;
  red_club_abbrev: string | null;
  blue_name: string;
  blue_club_abbrev: string | null;
  red_score: number | null;
  blue_score: number | null;
  status: string;
  lice_id: string | null;
  referee_id: string | null;
  match_number_label: string | null;
}

interface PoolWithMatches {
  poolId: string;
  poolName: string;
  matches: MatchRow[];
}

interface Lice {
  id: string;
  name: string;
}

interface Referee {
  id: string;
  display_name: string;
  given_name?: string;
  family_name?: string;
}

interface MatchesTabProps {
  tournamentId: string;
  poolPhaseId: string;
  slug: string;
  eventId: string;
}

export function MatchesTab({ tournamentId, poolPhaseId, slug, eventId }: MatchesTabProps) {
  const router = useRouter();
  const [pools, setPools] = useState<PoolWithMatches[]>([]);
  const [weapon, setWeapon] = useState<string | null>(null);
  const [redColor, setRedColor] = useState<ColorToken>('red');
  const [blueColor, setBlueColor] = useState<ColorToken>('blue');
  const [lices, setLices] = useState<Lice[]>([]);
  const [referees, setReferees] = useState<Referee[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    setLoading(true);
    void Promise.all([
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/pools-with-matches`, {
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, {
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${apiUrl}/api/v1/events/${eventId}/persons?is_referee=true`, {
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : [])),
    ]).then(([poolsData, tournamentData, licesData, refereesData]) => {
      setPools(poolsData as PoolWithMatches[]);
      const tournament = tournamentData as {
        weapon?: string | null;
        scoring_config?: { display?: { sideColors?: { red: string; blue: string } } };
      } | null;
      setWeapon(tournament?.weapon ?? null);
      const sc = tournament?.scoring_config;
      if (sc?.display?.sideColors) {
        setRedColor((sc.display.sideColors.red as ColorToken) ?? 'red');
        setBlueColor((sc.display.sideColors.blue as ColorToken) ?? 'blue');
      }
      setLices(licesData as Lice[]);
      setReferees(refereesData as Referee[]);
      setLoading(false);
    });
  }, [tournamentId, eventId, poolPhaseId, refreshKey]);

  // Surgical sync: pull (id, status, red_score, blue_score) only and
  // merge in place. Used by both the manual entry-point and the 30s
  // fallback poll. Object identity on unchanged rows lets React skip
  // the re-render → open <select> dropdowns stay open, no flicker.
  const syncScores = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/match-scores`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const updates = (await res.json()) as MatchScoreUpdate[];
      setPools((prev) => mergeScores(prev, updates));
    } catch {
      // Network blip — leave state untouched. Next poll cycle retries.
    }
  }, [tournamentId]);

  useRealtimeWithFallback({
    channelName: `pool-matches-list-${tournamentId}`,
    table: 'matches',
    filter: `phase_id=eq.${poolPhaseId}`,
    event: '*',
    onEvent: (payload) => {
      const incoming = payload.new as MatchRow | null;
      if (!incoming) return;
      setPools((prev) =>
        prev.map((pool) => ({
          ...pool,
          matches: pool.matches.map((m) => (m.id === incoming.id ? { ...m, ...incoming } : m)),
        })),
      );
    },
    // Was: `refresh` (full refetch). The lighter path keeps the table
    // mounted; only changed rows re-render. The "Refresh" button at
    // the top of the tab still calls full `refresh` for an explicit
    // operator override.
    onFallbackPoll: syncScores,
    fallbackPollMs: 30_000,
  });

  async function updateMatchAssignment(
    matchId: string,
    field: 'liceId' | 'refereeId',
    value: string | null,
  ) {
    const dbField = field === 'liceId' ? 'lice_id' : 'referee_id';
    setPools((prev) =>
      prev.map((pool) => ({
        ...pool,
        matches: pool.matches.map((m) => (m.id === matchId ? { ...m, [dbField]: value } : m)),
      })),
    );
    try {
      const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error('Update failed');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Match assignment update failed:', err);
      refresh();
    }
  }

  function refereeLabel(r: Referee): string {
    if (r.display_name) return r.display_name;
    const name = `${r.given_name ?? ''} ${r.family_name ?? ''}`.trim();
    return name || r.id;
  }

  if (loading) {
    return <p className="text-sm text-slate-500">{t('common.loading')}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={refresh}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t('actions.refresh')}
        </button>
      </div>

      {pools.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
          {t('organizer.pools.matches.noPools')}
        </p>
      )}

      {/*
        Responsive pool grid — stacked on phones, side-by-side from md+.
        Capped at 2 columns so each pool card stays readable even on
        ultrawide monitors. Operators consistently running 6+ tiny pools
        can bump to xl:grid-cols-3 as a one-line follow-up.
      */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {pools.map((pool, poolIdx) => {
          const done = pool.matches.filter((m) => m.status === 'completed').length;
          const total = pool.matches.length;
          // Pools come back ordered by sort_order ascending, so the array
          // index is the canonical "pool 1, pool 2, …" display number.
          const poolNumber = poolIdx + 1;
          return (
            <section key={pool.poolId} className="rounded-lg border border-slate-200 bg-white">
              <header className="border-b border-slate-200 px-4 py-3">
                <h3 className="font-semibold text-slate-900">{pool.poolName}</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t('organizer.pools.matches.summary', {
                    done: String(done),
                    total: String(total),
                  })}
                </p>
              </header>

              {pool.matches.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-400">
                  {t('organizer.pools.matches.empty')}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="w-16 px-4 py-2">{t('organizer.pools.matches.round')}</th>
                        {/*
                      Score is rendered inline next to each fighter name in
                      the Red/Blue columns below, with winner bold. The
                      dedicated Score column was redundant.
                    */}
                        <th className="px-4 py-2">{t('organizer.pools.matches.red')}</th>
                        <th className="px-4 py-2">{t('organizer.pools.matches.blue')}</th>
                        <th className="w-32 px-4 py-2">{t('organizer.pools.matches.status')}</th>
                        <th className="w-32 px-4 py-2">{t('organizer.pools.matches.lice')}</th>
                        <th className="w-32 px-4 py-2">{t('organizer.pools.matches.referee')}</th>
                        <th className="w-10 px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {pool.matches.map((m) => {
                        const scoreboardHref = `/org/${slug}/events/${eventId}/matches/${m.id}/scoreboard`;
                        const auditHref = `/org/${slug}/events/${eventId}/matches/${m.id}`;
                        // Winner-bold rule: only completed matches with a
                        // clear differential elect a winner. Ties leave both
                        // sides in the regular weight — matches the engine
                        // semantics where ties have no winner row.
                        const isCompleted = m.status === 'completed';
                        const redScore = m.red_score ?? 0;
                        const blueScore = m.blue_score ?? 0;
                        const isRedWinner = isCompleted && redScore > blueScore;
                        const isBlueWinner = isCompleted && blueScore > redScore;
                        return (
                          <tr
                            key={m.id}
                            role="link"
                            tabIndex={0}
                            aria-label={t('organizer.pool.match.openScoreboard')}
                            onClick={() => router.push(scoreboardHref)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                router.push(scoreboardHref);
                              }
                            }}
                            className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-300"
                          >
                            <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-500">
                              {formatRoundCode({
                                weapon,
                                poolNumber,
                                bracketRound: null,
                                bracketSize: null,
                                matchNumber: m.match_number_label ?? m.round_number,
                              })}
                            </td>
                            <td className="px-4 py-2">
                              <span className="flex items-center gap-2">
                                <span
                                  className={`h-6 w-1 rounded ${accentClassFor(redColor)}`}
                                  aria-hidden="true"
                                />
                                <span
                                  className={
                                    isRedWinner
                                      ? 'font-bold text-slate-900'
                                      : 'font-medium text-slate-900'
                                  }
                                >
                                  {m.red_name}
                                </span>
                                {m.red_club_abbrev && (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                                    {m.red_club_abbrev}
                                  </span>
                                )}
                                {isCompleted && (
                                  <span
                                    className={`ml-auto font-mono text-sm ${
                                      isRedWinner ? 'font-bold text-slate-900' : 'text-slate-600'
                                    }`}
                                  >
                                    {redScore}
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <span className="flex items-center gap-2">
                                <span
                                  className={`h-6 w-1 rounded ${accentClassFor(blueColor)}`}
                                  aria-hidden="true"
                                />
                                <span
                                  className={
                                    isBlueWinner
                                      ? 'font-bold text-slate-900'
                                      : 'font-medium text-slate-900'
                                  }
                                >
                                  {m.blue_name}
                                </span>
                                {m.blue_club_abbrev && (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                                    {m.blue_club_abbrev}
                                  </span>
                                )}
                                {isCompleted && (
                                  <span
                                    className={`ml-auto font-mono text-sm ${
                                      isBlueWinner ? 'font-bold text-slate-900' : 'text-slate-600'
                                    }`}
                                  >
                                    {blueScore}
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <StatusPill status={m.status} />
                            </td>
                            <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                              <select
                                value={m.lice_id ?? ''}
                                onChange={(e) =>
                                  void updateMatchAssignment(m.id, 'liceId', e.target.value || null)
                                }
                                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                              >
                                <option value="">{t('common.none')}</option>
                                {lices.map((l) => (
                                  <option key={l.id} value={l.id}>
                                    {l.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                              <select
                                value={m.referee_id ?? ''}
                                onChange={(e) =>
                                  void updateMatchAssignment(
                                    m.id,
                                    'refereeId',
                                    e.target.value || null,
                                  )
                                }
                                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                              >
                                <option value="">{t('common.none')}</option>
                                {referees.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {refereeLabel(r)}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                              <Link
                                href={auditHref}
                                className="inline-flex items-center justify-center rounded p-1 text-slate-600 hover:bg-slate-200"
                                title={t('organizer.pool.match.openAudit')}
                                aria-label={t('organizer.pool.match.openAudit')}
                              >
                                {/* Inline SVG: magnifying glass over a document (audit / file-search) */}
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14 2 14 8 20 8" />
                                  <circle cx="11.5" cy="14.5" r="2.5" />
                                  <line x1="13.5" y1="16.5" x2="16" y2="19" />
                                </svg>
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    scheduled: 'bg-slate-100 text-slate-700',
    ready: 'bg-amber-100 text-amber-700',
    running: 'bg-red-100 text-red-700',
    completed: 'bg-green-100 text-green-700',
    forfeit: 'bg-slate-200 text-slate-600',
    disqualified: 'bg-slate-200 text-slate-600',
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? colors['scheduled']}`}
    >
      {status}
    </span>
  );
}
