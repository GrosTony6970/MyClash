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
import { minutesIntoDayInZone, zonedDay } from '@myclash/time';

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

/** Column headers, supplied by the caller from `t()` — see `CsvLabels`. */
export interface CsvLabels {
  day: string;
  lice: string;
  start: string;
  round: string;
  tournament: string;
  group: string;
  red: string;
  blue: string;
  status: string;
}

/**
 * Formula-safe: the schedule is downloaded and opened in a spreadsheet, and
 * fighter, tournament and lice names come from organiser input.
 * See @myclash/types/csv.
 */
const esc = escapeCsvCell;

function headerRow(labels: CsvLabels): string {
  return [
    labels.day,
    labels.lice,
    labels.start,
    labels.round,
    labels.tournament,
    labels.group,
    labels.red,
    labels.blue,
    labels.status,
  ]
    .map(esc)
    .join(',');
}

/** `HH:MM` on the EVENT's wall clock — locale-free and zone-correct. */
function hhmm(iso: string, tz: string): string {
  const minutes = minutesIntoDayInZone(iso, tz);
  if (minutes === null) return '';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function scheduleToCsv(
  matches: CsvMatch[],
  liceNameById: Map<string, string>,
  tz: string,
  labels: CsvLabels,
): string {
  const rows = matches
    .filter((m) => m.scheduledAt && m.liceId)
    .map((m) => {
      const liceName = liceNameById.get(m.liceId!) ?? m.liceId!;
      // The event's calendar day, not the UTC prefix of the ISO string — a
      // 00:30 Paris bout filed under the previous day on the sheet that gets
      // taped to the wall.
      const day = zonedDay(m.scheduledAt!, tz) ?? m.scheduledAt!.slice(0, 10);
      const group = m.poolName ?? parseBracketRound(m.roundCode)?.label ?? '';
      return {
        day,
        liceName,
        startIso: m.scheduledAt!,
        cells: [
          day,
          liceName,
          hhmm(m.scheduledAt!, tz),
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

  return [headerRow(labels), ...rows.map((r) => r.cells.map(esc).join(','))].join('\n');
}
