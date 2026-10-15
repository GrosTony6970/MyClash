/**
 * Pure CSV / print-HTML builders for the final ranking. Kept free of React + I/O
 * so the row→text mapping is unit-testable; the page does the download and the
 * print-window open. Columns mirror the on-screen table; the page hands in their
 * titles, in the reader's language (O20).
 */

import { escapeHtml, type CsvFormat } from '@myclash/types';
import { csvFile } from '@/lib/csv-file';

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

/** The five column titles: rank, fighter, club, result, pool score. */
export type RankingHeaders = readonly [string, string, string, string, string];

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
  return csvFile(
    [headers, ...rows.map((r) => [r.rank, r.fighter, r.club, r.result, r.poolScore])],
    format,
  );
}

const htmlEscape = escapeHtml;

export function rankingToPrintHtml(
  title: string,
  rows: ExportRow[],
  headers: RankingHeaders,
): string {
  const body = rows
    .map(
      (r) =>
        `<tr><td class="r">${r.rank}</td><td>${htmlEscape(r.fighter)}</td><td>${htmlEscape(
          r.club,
        )}</td><td>${htmlEscape(r.result)}</td><td class="r">${htmlEscape(r.poolScore)}</td></tr>`,
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
    headers.map((h) => `<th>${htmlEscape(h)}</th>`).join('') +
    `</tr></thead><tbody>${body}</tbody></table></body></html>`
  );
}
