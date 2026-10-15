/**
 * full-event-csv.ts — one row of the full event CSV (`events/:id/exports/full.csv`) per hit.
 *
 * Pure: the read is `ExportsService.fetchEventExchanges`, the file is written by `csvDownload`,
 * whose every cell is formula-safe: the file is opened in a spreadsheet and carries
 * organiser-written text (Tournament names, void reasons). See @myclash/types/csv.
 */
import { formatRoundCode, roundCodeShapeFromConfig } from '@myclash/types';
import type { Row } from './hema-ratings-rows';

export const FULL_CSV_HEADER = [
  'tournament',
  'round_code',
  'match',
  'sequence',
  'type',
  'first_striker',
  'first_strike_value',
  'afterblow_value',
  'no_exchange_reason',
  'clock_time_ms',
  'voided',
  'voided_reason',
];

/** A hit read with its bout, Pool or bracket slot, phase and Tournament embedded. */
export function fullCsvRow(row: Row): unknown[] {
  const match = row['matches'] as Record<string, unknown> | null;
  const phase = match?.['phases'] as Record<string, unknown> | null;
  const tournament = phase?.['tournaments'] as {
    name: string;
    weapon?: string | null;
  } | null;
  const phaseConfig = (phase?.['config_json'] ?? null) as Record<string, unknown> | null;
  const sizeRaw = (phaseConfig?.['bracketSize'] ?? phaseConfig?.['mainBracketSize']) as
    number | undefined;
  const bracketSize: number | null = typeof sizeRaw === 'number' ? sizeRaw : null;
  const pool = match?.['pools'] as { sort_order?: number } | null;
  const bracketSlot = match?.['bracket_slots'] as { round?: number } | null;
  const swissRound = match?.['swiss_rounds'] as { round_number?: number } | null;
  const matchLabel = (match?.['match_number_label'] as string | null) ?? '';

  const roundCode = formatRoundCode({
    weapon: tournament?.weapon ?? null,
    poolNumber: typeof pool?.sort_order === 'number' ? pool.sort_order + 1 : null,
    bracketRound: typeof bracketSlot?.round === 'number' ? bracketSlot.round : null,
    bracketSize,
    // Without this a Swiss exchange row exports as a segment-less LSW-M1,
    // indistinguishable from an unclassifiable match.
    swissRound: typeof swissRound?.round_number === 'number' ? swissRound.round_number : null,
    matchNumber: matchLabel || null,
    // Without the WB/LB split a double-elim bracket falls back to
    // single-elim labels, so the winners final, the grand final and the
    // reset all export as "F".
    ...roundCodeShapeFromConfig(phaseConfig),
  });

  return [
    tournament?.name,
    roundCode,
    matchLabel,
    row['sequence'],
    row['type'],
    row['first_striker_color'],
    row['first_strike_value'],
    row['afterblow_value'],
    row['no_exchange_reason'],
    row['clock_time_ms'],
    row['voided'] ? 'true' : 'false',
    row['voided_reason'],
  ];
}
