/**
 * Pure CSV / print-HTML builders for the final ranking. Kept free of React + I/O
 * so the row→text mapping is unit-testable; the page does the Blob download and
 * the print-window open. Columns mirror the on-screen table.
 */

import { escapeCsvCell, escapeHtml } from '@myclash/types';

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

const HEADERS = ['Rank', 'Fighter', 'Club', 'Result', 'Pool score'] as const;

/**
 * Formula-safe: this file is downloaded and opened in a spreadsheet, and fighter
 * and club names come from the roster, which organisers type. See
 * @myclash/types/csv — plain numbers stay numeric so pool score still sums.
 */
const csvEscape = escapeCsvCell;

export function rankingToCsv(rows: ExportRow[]): string {
  const lines = [HEADERS.join(',')];
  for (const r of rows) {
    lines.push([String(r.rank), r.fighter, r.club, r.result, r.poolScore].map(csvEscape).join(','));
  }
  return lines.join('\r\n');
}

const htmlEscape = escapeHtml;

export function rankingToPrintHtml(title: string, rows: ExportRow[]): string {
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
    HEADERS.map((h) => `<th>${h}</th>`).join('') +
    `</tr></thead><tbody>${body}</tbody></table></body></html>`
  );
}
