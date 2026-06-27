'use client';

/**
 * StandingsTable — T-605
 *
 * Renders pool standings in lyonamhe.fr layout: V / Pts+ / Pts− / Dbl / Score
 * Subscribes to Supabase Realtime for live updates when exchanges change.
 *
 * AC: Pool standings update live (within 1s of exchange entry).
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getApiUrl } from '@/lib/api-url';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import type { StandingRow } from './page';

interface Props {
  poolId: string;
  poolName: string;
  initialStandings: StandingRow[];
  tournamentId: string;
}

export function StandingsTable({
  poolId,
  poolName,
  initialStandings,
  tournamentId: _tournamentId,
}: Props) {
  const { t } = useI18n();
  const [standings, setStandings] = useState<StandingRow[]>(initialStandings);
  const [updating, setUpdating] = useState(false);

  // Re-fetch standings from API
  async function refresh() {
    setUpdating(true);
    try {
      // Resolve client-side — the public (browser-reachable) URL.
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/api/v1/pools/${poolId}/standings`, { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as StandingRow[];
        setStandings(data);
      }
    } catch {
      // Swallow — keep showing last known standings
    } finally {
      setUpdating(false);
    }
  }

  // Subscribe to exchange changes for this pool's matches
  useEffect(() => {
    const channel = supabase
      .channel(`pool-standings-${poolId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'exchanges',
          filter: `pool_id=eq.${poolId}`,
        },
        () => {
          // Exchange changed → re-fetch standings
          void refresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId]);

  return (
    <div
      className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
      role="region"
      aria-label={t('publicApp.tournament.standings.poolRegionLabel', { pool: poolName })}
      aria-live="polite"
    >
      <h3 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-slate-900 sm:text-xl">
        {poolName}
        {updating && (
          <span
            aria-hidden="true"
            className="h-3 w-3 animate-spin rounded-full border border-stone-300 border-t-red-700"
          />
        )}
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-xs uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-3 text-left font-semibold">
                {t('publicApp.tournament.standings.colFighter')}
              </th>
              <th className="w-8 px-2 py-2 text-center font-semibold">
                {t('publicApp.tournament.standings.colWins')}
              </th>
              <th className="w-10 px-2 py-2 text-center font-semibold">
                {t('publicApp.tournament.standings.colPointsFor')}
              </th>
              <th className="w-10 px-2 py-2 text-center font-semibold">
                {t('publicApp.tournament.standings.colPointsAgainst')}
              </th>
              <th className="w-8 px-2 py-2 text-center font-semibold">
                {t('publicApp.tournament.standings.colDoubles')}
              </th>
              <th className="w-16 py-2 pl-2 text-right font-semibold">
                {t('publicApp.tournament.standings.colScore')}
              </th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, idx) => (
              <tr
                key={row.registrationId}
                className={[
                  'border-b border-stone-100',
                  idx === 0 ? 'text-slate-900' : 'text-slate-700',
                ].join(' ')}
              >
                <td className="py-2 pr-3">
                  <p className="font-medium leading-tight">{row.fighterName}</p>
                  {row.clubName && <p className="text-xs text-slate-500">{row.clubName}</p>}
                </td>
                <td className="px-2 py-2 text-center font-bold">{row.wins}</td>
                <td className="px-2 py-2 text-center">{row.pointsFor}</td>
                <td className="px-2 py-2 text-center">{row.pointsAgainst}</td>
                <td className="px-2 py-2 text-center">{row.doubles}</td>
                <td className="py-2 pl-2 text-right font-mono font-bold">{row.score.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
