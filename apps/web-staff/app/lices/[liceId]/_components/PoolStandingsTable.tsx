'use client';

import { useI18n } from '@myclash/next-i18n/client';
import type {
  StandingsColumn,
  StandingsRow,
} from '../../../../src/components/tournament-context-types';

/**
 * Format one cell against its column definition.
 *
 * `decimals` matters: the ruleset score column is a ratio and ships
 * `decimals: 2`. Printing it raw would show 4.666666666666667 on a piste.
 */
function formatStat(column: StandingsColumn, value: number | string | undefined): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'number' && column.decimals !== undefined) {
    return value.toFixed(column.decimals);
  }
  return String(value);
}

/**
 * Pool standings, exactly as the server computed them.
 *
 * Columns are DYNAMIC — they come from the tournament's ruleset, so they are
 * rendered from `columns[]` rather than hardcoded. Nothing here recomputes a
 * score: a second, divergent standings implementation once silently returned
 * all-zeros in this product, and rendering what the endpoint sends is the only
 * way that cannot happen again.
 */
export function PoolStandingsTable({
  columns,
  rows,
}: {
  columns: StandingsColumn[];
  rows: StandingsRow[];
}) {
  const { t } = useI18n();
  if (rows.length === 0) {
    return (
      <p className="px-3 py-4 text-center text-sm text-muted">{t('scoring.lice.standingsEmpty')}</p>
    );
  }
  return (
    // A ten-column ruleset will not fit 390px; the table scrolls, the page does not.
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-2 py-1.5 font-semibold">{t('scoring.lice.standingsRank')}</th>
            <th className="px-2 py-1.5 font-semibold">{t('scoring.lice.standingsFighter')}</th>
            {columns.map((column) => (
              <th key={column.key} className="px-2 py-1.5 text-right font-semibold">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.registrationId} className="border-b border-border/60 last:border-0">
              <td className="px-2 py-1.5 font-mono tabular-nums text-muted">{row.rank}</td>
              <td className="px-2 py-1.5">
                <span className="font-semibold">{row.displayName}</span>
                {row.club?.abbreviation && (
                  <span className="ml-1 text-xs text-muted">{row.club.abbreviation}</span>
                )}
              </td>
              {columns.map((column) => (
                <td key={column.key} className="px-2 py-1.5 text-right font-mono tabular-nums">
                  {formatStat(column, row.stats[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
