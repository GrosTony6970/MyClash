/**
 * Pure CSV / print-HTML builders for the referee compensation report. Kept free
 * of React + I/O so the row→text mapping is unit-testable; the page does the
 * download and the print-window open. Columns mirror the on-screen table. The
 * page hands in every word (the column titles, Yes / No, Total) in the reader's
 * language (O20); the print title is passed in already localized.
 */

import { csvFile, escapeHtml, type CompensationReport, type CsvFormat } from '@myclash/types';

type Referee = CompensationReport['referees'][number];

/** The words of the file and the print, in the reader's language. */
export interface CompensationWords {
  /** Referee, Pool, Swiss, Bracket, Finals, Total tokens, Amount (EUR), Paid. */
  headers: readonly [string, string, string, string, string, string, string, string];
  yes: string;
  no: string;
  total: string;
}

/** Index of the amount column, so the total row's padding follows the header
 *  list instead of a hand-counted run of empty strings. */
const AMOUNT_COLUMN = 6;

/** Sum of a referee's breakdown subtotals for one phase (matches the UI cell). */
function phaseTokens(referee: Referee, phase: string): number {
  return referee.breakdown.filter((b) => b.phase === phase).reduce((sum, b) => sum + b.subtotal, 0);
}

function refereeCells(r: Referee, words: CompensationWords): string[] {
  return [
    r.displayName,
    phaseTokens(r, 'pool').toFixed(1),
    phaseTokens(r, 'swiss').toFixed(1),
    phaseTokens(r, 'bracket').toFixed(1),
    phaseTokens(r, 'finals').toFixed(1),
    r.totalTokens.toFixed(1),
    r.amountOwed.toFixed(2),
    r.paid ? words.yes : words.no,
  ];
}

/**
 * Formula-safe through `csvFile`: this file is opened in a spreadsheet, and referee names come
 * from the roster, which organisers type. Plain numbers stay numeric so the amount column
 * still sums.
 */
export function compensationToCsv(
  report: CompensationReport,
  words: CompensationWords,
  format: CsvFormat,
): string {
  const totalCells = words.headers.map((_, i) =>
    i === 0 ? words.total : i === AMOUNT_COLUMN ? report.grandTotal.toFixed(2) : '',
  );
  return csvFile(
    [words.headers, ...report.referees.map((r) => refereeCells(r, words)), totalCells],
    format,
  );
}

const htmlEscape = escapeHtml;

export function compensationToPrintHtml(
  title: string,
  report: CompensationReport,
  words: CompensationWords,
): string {
  const body = report.referees
    .map((r) => {
      const [name, ...rest] = refereeCells(r, words);
      return (
        `<tr><td>${htmlEscape(name ?? '')}</td>` +
        rest.map((cell) => `<td class="r">${htmlEscape(cell)}</td>`).join('') +
        `</tr>`
      );
    })
    .join('');
  const totalRow =
    `<tr class="total"><td>${htmlEscape(words.total)}</td>` +
    words.headers
      .slice(1)
      .map((_, i) =>
        i + 1 === AMOUNT_COLUMN
          ? `<td class="r">${report.grandTotal.toFixed(2)}</td>`
          : '<td></td>',
      )
      .join('') +
    `</tr>`;
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(title)}</title>` +
    `<style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}` +
    `h1{font-size:18px;margin:0 0 12px}` +
    `table{border-collapse:collapse;width:100%;font-size:12px}` +
    `th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}` +
    `th{background:#f3f4f6}td.r{text-align:right}tr.total td{font-weight:bold}</style>` +
    `</head><body><h1>${htmlEscape(title)}</h1><table><thead><tr>` +
    words.headers.map((h) => `<th>${htmlEscape(h)}</th>`).join('') +
    `</tr></thead><tbody>${body}${totalRow}</tbody></table></body></html>`
  );
}
