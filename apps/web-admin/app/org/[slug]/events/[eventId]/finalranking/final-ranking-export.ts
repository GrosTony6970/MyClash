/**
 * Pure CSV / print-HTML builders for the final ranking. Kept free of React + I/O
 * so the row→text mapping is unit-testable; the page does the download and the
 * print-window open. Columns mirror the on-screen table; the page hands in their
 * titles, in the reader's language (O20).
 */

import { csvFile, escapeHtml, type CsvFormat } from '@myclash/types';

export interface ExportRow {
  rank: number;
  fighter: string;
  /** Club abbreviation/name, or '' when unaffiliated. */
  club: string;
  /** Result label, e.g. "Champion", "Quarter-finals", "Pools". */
  result: string;
  /** Pool score pre-formatted (e.g. "4.00"), or '' when none. */
  poolScore: string;
}

/**
 * The column titles: rank, entrant, club, result, pool score. A team has no club
 * (`@myclash/types/bracket-side`): a team ranking passes `club: null` and its file and print have
 * no Club column, as the table on screen shows none for a team.
 */
export interface RankingHeaders {
  rank: string;
  entrant: string;
  club: string | null;
  result: string;
  poolScore: string;
}

interface Column {
  title: string;
  cell: (row: ExportRow) => string | number;
  /** Right-aligned in the print. */
  numeric?: boolean;
}

/** The columns of the file and the print, in order: the one place that decides which appear. */
function columnsOf(headers: RankingHeaders): Column[] {
  const club: Column[] =
    headers.club === null ? [] : [{ title: headers.club, cell: (r) => r.club }];
  return [
    { title: headers.rank, cell: (r) => r.rank, numeric: true },
    { title: headers.entrant, cell: (r) => r.fighter },
    ...club,
    { title: headers.result, cell: (r) => r.result },
    { title: headers.poolScore, cell: (r) => r.poolScore, numeric: true },
  ];
}

/**
 * Formula-safe through `csvFile`: this file is opened in a spreadsheet, and fighter and club
 * names come from the roster, which organisers type. Plain numbers stay numeric so pool
 * score still sums.
 */
export function rankingToCsv(
  rows: ExportRow[],
  headers: RankingHeaders,
  format: CsvFormat,
): string {
  const columns = columnsOf(headers);
  return csvFile(
    [columns.map((c) => c.title), ...rows.map((r) => columns.map((c) => c.cell(r)))],
    format,
  );
}

const htmlEscape = escapeHtml;

export function rankingToPrintHtml(
  title: string,
  rows: ExportRow[],
  headers: RankingHeaders,
): string {
  const columns = columnsOf(headers);
  const body = rows
    .map(
      (r) =>
        `<tr>${columns
          .map((c) => `<td${c.numeric ? ' class="r"' : ''}>${htmlEscape(String(c.cell(r)))}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(title)}</title>` +
    `<style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}` +
    `h1{font-size:18px;margin:0 0 12px}` +
    `table{border-collapse:collapse;width:100%;font-size:12px}` +
    `th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}` +
    `th{background:#f3f4f6}td.r{text-align:right}td.r:first-child{text-align:center;width:48px}</style>` +
    `</head><body><h1>${htmlEscape(title)}</h1><table><thead><tr>` +
    columns.map((c) => `<th>${htmlEscape(c.title)}</th>`).join('') +
    `</tr></thead><tbody>${body}</tbody></table></body></html>`
  );
}
