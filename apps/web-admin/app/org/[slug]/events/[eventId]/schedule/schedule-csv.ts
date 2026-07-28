/**
 * Serialize the scheduled matches to CSV (RFC 4180) for posting at the venue
 * / handing to refs+fighters. Rows are sorted by day, then lice, then start;
 * the lice + tournament + fighter columns let the operator filter per-lice /
 * per-tournament / per-fighter in a spreadsheet. Unscheduled matches (no time
 * or no lice) are excluded.
 *
 * Pure: no React, no I/O.
 */
import { parseBracketRound } from '@myclash/schedule-core';
import { escapeCsvCell } from '@myclash/types';

export interface CsvMatch {
  scheduledAt: string | null;
  liceId: string | null;
  roundCode?: string;
  matchNumberLabel: string;
  tournamentName: string | null;
  poolName: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  status: string;
}

const HEADER = 'Day,Lice,Start,Round,Tournament,Pool/Round,Red,Blue,Status';

/**
 * Formula-safe: the schedule is downloaded and opened in a spreadsheet, and
 * fighter, tournament and lice names come from organiser input.
 * See @myclash/types/csv.
 */
const esc = escapeCsvCell;

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

export function scheduleToCsv(matches: CsvMatch[], liceNameById: Map<string, string>): string {
  const rows = matches
    .filter((m) => m.scheduledAt && m.liceId)
    .map((m) => {
      const liceName = liceNameById.get(m.liceId!) ?? m.liceId!;
      const day = m.scheduledAt!.slice(0, 10);
      const group = m.poolName ?? parseBracketRound(m.roundCode)?.label ?? '';
      return {
        day,
        liceName,
        startIso: m.scheduledAt!,
        cells: [
          day,
          liceName,
          hhmm(m.scheduledAt!),
          m.roundCode ?? m.matchNumberLabel,
          m.tournamentName ?? '',
          group,
          m.redFighterName ?? '',
          m.blueFighterName ?? '',
          m.status,
        ],
      };
    })
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.liceName.localeCompare(b.liceName, undefined, { numeric: true }) ||
        a.startIso.localeCompare(b.startIso),
    );

  return [HEADER, ...rows.map((r) => r.cells.map(esc).join(','))].join('\n');
}
