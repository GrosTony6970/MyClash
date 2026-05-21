'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { t } from '@myclash/i18n';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { accentClassFor, type ColorToken } from './color-token';

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
  const [pools, setPools] = useState<PoolWithMatches[]>([]);
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
      const sc = (
        tournamentData as {
          scoring_config?: { display?: { sideColors?: { red: string; blue: string } } };
        } | null
      )?.scoring_config;
      if (sc?.display?.sideColors) {
        setRedColor((sc.display.sideColors.red as ColorToken) ?? 'red');
        setBlueColor((sc.display.sideColors.blue as ColorToken) ?? 'blue');
      }
      setLices(licesData as Lice[]);
      setReferees(refereesData as Referee[]);
      setLoading(false);
    });
  }, [tournamentId, eventId, poolPhaseId, refreshKey]);

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
    onFallbackPoll: refresh,
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

      {pools.map((pool) => {
        const done = pool.matches.filter((m) => m.status === 'completed').length;
        const total = pool.matches.length;
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
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-16 px-4 py-2">{t('organizer.pools.matches.round')}</th>
                    <th className="px-4 py-2">{t('organizer.pools.matches.red')}</th>
                    <th className="px-4 py-2">{t('organizer.pools.matches.blue')}</th>
                    <th className="w-24 px-4 py-2">{t('organizer.pools.matches.score')}</th>
                    <th className="w-32 px-4 py-2">{t('organizer.pools.matches.status')}</th>
                    <th className="w-32 px-4 py-2">{t('organizer.pools.matches.lice')}</th>
                    <th className="w-32 px-4 py-2">{t('organizer.pools.matches.referee')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pool.matches.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                    >
                      <td className="px-4 py-2 text-slate-500">
                        {m.match_number_label ?? m.round_number}
                      </td>
                      <td className="px-4 py-2">
                        <Link
                          href={`/org/${slug}/events/${eventId}/matches/${m.id}`}
                          className="flex items-center gap-2 hover:underline"
                        >
                          <span
                            className={`h-6 w-1 rounded ${accentClassFor(redColor)}`}
                            aria-hidden="true"
                          />
                          <span className="font-medium text-slate-900">{m.red_name}</span>
                          {m.red_club_abbrev && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                              {m.red_club_abbrev}
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        <Link
                          href={`/org/${slug}/events/${eventId}/matches/${m.id}`}
                          className="flex items-center gap-2 hover:underline"
                        >
                          <span
                            className={`h-6 w-1 rounded ${accentClassFor(blueColor)}`}
                            aria-hidden="true"
                          />
                          <span className="font-medium text-slate-900">{m.blue_name}</span>
                          {m.blue_club_abbrev && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                              {m.blue_club_abbrev}
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-2 font-mono text-slate-700">
                        {m.status === 'completed'
                          ? `${m.red_score ?? 0} — ${m.blue_score ?? 0}`
                          : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <StatusPill status={m.status} />
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={m.lice_id ?? ''}
                          onClick={(e) => e.stopPropagation()}
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
                      <td className="px-4 py-2">
                        <select
                          value={m.referee_id ?? ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            void updateMatchAssignment(m.id, 'refereeId', e.target.value || null)
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
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
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
