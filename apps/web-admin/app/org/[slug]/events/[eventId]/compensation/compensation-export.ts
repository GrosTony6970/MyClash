/**
 * Pure CSV / print-HTML builders for the referee compensation report. Kept free
 * of React + I/O so the row→text mapping is unit-testable; the page does the
 * Blob download and the print-window open. Columns mirror the on-screen table.
 * Headers are English by convention (see final-ranking-export.ts); the print
 * title is passed in already localized.
 */

import { escapeCsvCell, escapeHtml, type CompensationReport } from '@myclash/types';

type Referee = CompensationReport['referees'][number];

const HEADERS = [
  'Referee',
  'Pool',
  'Swiss',
  'Bracket',
  'Finals',
  'Total tokens',
  'Amount (EUR)',
  'Paid',
] as const;

/** Index of the 'Amount (EUR)' column, so the total row's padding follows the
 *  header list instead of a hand-counted run of empty strings. */
const AMOUNT_COLUMN = HEADERS.indexOf('Amount (EUR)');

/**
 * Formula-safe: this file is downloaded and opened in a spreadsheet, and referee
 * names come from the roster, which organisers type. See @myclash/types/csv —
 * plain numbers stay numeric so the amount column still sums.
 */
const csvEscape = escapeCsvCell;

/** Sum of a referee's breakdown subtotals for one phase (matches the UI cell). */
function phaseTokens(referee: Referee, phase: string): number {
  return referee.breakdown.filter((b) => b.phase === phase).reduce((sum, b) => sum + b.subtotal, 0);
}

function refereeCells(r: Referee): string[] {
  return [
    r.displayName,
    phaseTokens(r, 'pool').toFixed(1),
    phaseTokens(r, 'swiss').toFixed(1),
    phaseTokens(r, 'bracket').toFixed(1),
    phaseTokens(r, 'finals').toFixed(1),
    r.totalTokens.toFixed(1),
    r.amountOwed.toFixed(2),
    r.paid ? 'Yes' : 'No',
  ];
}

export function compensationToCsv(report: CompensationReport): string {
  const lines = [HEADERS.join(',')];
  for (const r of report.referees) {
    lines.push(refereeCells(r).map(csvEscape).join(','));
  }
  const totalCells = HEADERS.map((_, i) =>
    i === 0 ? 'Total' : i === AMOUNT_COLUMN ? report.grandTotal.toFixed(2) : '',
  );
  lines.push(totalCells.map(csvEscape).join(','));
  return lines.join('\r\n');
}

const htmlEscape = escapeHtml;

export function compensationToPrintHtml(title: string, report: CompensationReport): string {
  const body = report.referees
    .map((r) => {
      const [name, ...rest] = refereeCells(r);
      return (
        `<tr><td>${htmlEscape(name ?? '')}</td>` +
        rest.map((cell) => `<td class="r">${cell}</td>`).join('') +
        `</tr>`
      );
    })
    .join('');
  const totalRow =
    `<tr class="total"><td>Total</td>` +
    HEADERS.slice(1)
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
    HEADERS.map((h) => `<th>${h}</th>`).join('') +
    `</tr></thead><tbody>${body}${totalRow}</tbody></table></body></html>`
  );
}
