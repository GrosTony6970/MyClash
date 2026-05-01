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
import type { StandingRow } from './page';

interface Props {
  poolId: string;
  poolName: string;
  initialStandings: StandingRow[];
  tournamentId: string;
  apiUrl: string;
}

export function StandingsTable({
  poolId,
  poolName,
  initialStandings,
  tournamentId: _tournamentId,
  apiUrl,
}: Props) {
  const [standings, setStandings] = useState<StandingRow[]>(initialStandings);
  const [updating, setUpdating] = useState(false);

  // Re-fetch standings from API
  async function refresh() {
    setUpdating(true);
    try {
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
    <div>
      <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
        {poolName}
        {updating && (
          <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
        )}
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500 text-xs">
              <th className="text-left py-2 pr-3 font-medium">Fighter</th>
              <th className="text-center py-2 px-2 font-medium w-8">V</th>
              <th className="text-center py-2 px-2 font-medium w-10">Pts+</th>
              <th className="text-center py-2 px-2 font-medium w-10">Pts−</th>
              <th className="text-center py-2 px-2 font-medium w-8">Dbl</th>
              <th className="text-right py-2 pl-2 font-medium w-16">Score</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, idx) => (
              <tr
                key={row.registrationId}
                className={[
                  'border-b border-gray-900',
                  idx === 0 ? 'text-white' : 'text-gray-300',
                ].join(' ')}
              >
                <td className="py-2 pr-3">
                  <p className="font-medium leading-tight">{row.fighterName}</p>
                  {row.clubName && <p className="text-xs text-gray-500">{row.clubName}</p>}
                </td>
                <td className="text-center py-2 px-2 font-bold">{row.wins}</td>
                <td className="text-center py-2 px-2">{row.pointsFor}</td>
                <td className="text-center py-2 px-2">{row.pointsAgainst}</td>
                <td className="text-center py-2 px-2">{row.doubles}</td>
                <td className="text-right py-2 pl-2 font-mono font-bold">{row.score.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
