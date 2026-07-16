'use client';

/**
 * StandingsTable — T-605
 *
 * Renders pool standings in lyonamhe.fr layout: V / Pts+ / Pts− / Dbl / Score
 * Subscribes to Supabase Realtime for live updates when exchanges change.
 *
 * AC: Pool standings update live (within 1s of exchange entry).
 */

import { useState } from 'react';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { getPublicApiUrl } from '@/lib/api-url';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import type { StandingRow } from './page';

interface Props {
  poolId: string;
  poolName: string;
  initialStandings: StandingRow[];
  tournamentId: string;
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

export function StandingsTable({
  poolId,
  poolName,
  initialStandings,
  tournamentId: _tournamentId,
  highlightRegistrationId,
}: Props) {
  const { t } = useI18n();
  const [standings, setStandings] = useState<StandingRow[]>(initialStandings);
  const [updating, setUpdating] = useState(false);

  // Re-fetch standings from API
  async function refresh() {
    setUpdating(true);
    try {
      // Resolve client-side — the public (browser-reachable) URL.
      const apiUrl = getPublicApiUrl();
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

  // Subscribe to score changes for this pool's matches. NOTE: bind to
  // `matches` (updated on every exchange-driven score recompute), NOT to
  // `exchanges` — exchanges has no pool_id column, and an invalid filter
  // column errors the whole channel join (standings never live-refresh).
  // Flag-aware: honors the disable_realtime kill-switch + polls on WS loss.
  useRealtimeWithFallback({
    channelName: `pool-standings-${poolId}`,
    table: 'matches',
    filter: `pool_id=eq.${poolId}`,
    onEvent: () => void refresh(),
    onFallbackPoll: () => void refresh(),
  });

  return (
    <div
      className="rounded-xl border border-border bg-surface p-4 shadow-sm"
      role="region"
      aria-label={t('publicApp.tournament.standings.poolRegionLabel', { pool: poolName })}
      aria-live="polite"
    >
      <h3 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-foreground sm:text-xl">
        {poolName}
        {updating && (
          <span
            aria-hidden="true"
            className="h-3 w-3 animate-spin rounded-full border border-border border-t-accent"
          />
        )}
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wider text-muted">
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
              <th className="w-16 bg-accent/10 px-2 py-2 text-right font-bold normal-case tracking-normal text-accent">
                {t('publicApp.tournament.standings.colScore')}
              </th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, idx) => {
              const isYou =
                !!highlightRegistrationId && row.registrationId === highlightRegistrationId;
              return (
                <tr
                  key={row.registrationId}
                  className={[
                    'border-b border-border last:border-0',
                    isYou ? 'bg-accent/5' : '',
                    idx === 0 ? 'text-foreground' : 'text-foreground-secondary',
                  ].join(' ')}
                >
                  <td className="py-2 pr-3">
                    <p
                      className={[
                        'flex items-center gap-1 font-medium leading-tight',
                        isYou ? 'font-bold text-accent' : 'text-foreground',
                      ].join(' ')}
                    >
                      {row.fighterName}
                      {isYou && <YouChip label={t('publicApp.me.hub.youChip')} />}
                    </p>
                    {row.clubName && <p className="text-xs text-muted">{row.clubName}</p>}
                  </td>
                  <td className="px-2 py-2 text-center font-bold">{row.wins}</td>
                  <td className="px-2 py-2 text-center">{row.pointsFor}</td>
                  <td className="px-2 py-2 text-center">{row.pointsAgainst}</td>
                  <td className="px-2 py-2 text-center">{row.doubles}</td>
                  <td className="bg-accent/5 py-2 px-2 text-right font-mono font-bold text-foreground">
                    {row.score.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
