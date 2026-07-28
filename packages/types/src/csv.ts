/**
 * csv.ts — one CSV cell escaper for every export a human opens.
 *
 * Two separate jobs, and both matter:
 *
 * 1. RFC 4180 quoting, so a comma, quote or newline inside a value cannot break
 *    the row apart.
 *
 * 2. Formula neutralisation. A cell starting with `=`, `+`, `-` or `@` is
 *    evaluated as a formula by Excel, LibreOffice and Google Sheets. MyClash
 *    exports carry free text written by OTHER people — an organiser's `notes` on
 *    a roster row, a club name, an audit payload — so a planted
 *    `=cmd|' /c calc'!A1` fires on whoever opens the file. Prefixing with a
 *    single quote makes the cell literal text; spreadsheets strip the quote on
 *    display, so the reader sees the original value.
 *
 * NOT for machine-to-machine feeds. `escapeCsvCell` changes the bytes a parser
 * sees, which is correct for a human opening a spreadsheet and WRONG for a file
 * another system ingests — see `escapeCsvField` and the HEMA Ratings note in
 * apps/api/src/modules/exports/hema-ratings-format.ts.
 */

/** Leading characters a spreadsheet treats as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * A plain number is never a formula, and these exports are full of legitimately
 * negative values — score deltas, compensation adjustments, ranking movement.
 * Neutralising those would turn every one into text and stop the column summing,
 * which is the first thing an organiser does with the file.
 */
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

const NEEDS_QUOTING = /[",\n\r]/;

/** RFC 4180 quoting only. Use for feeds another system parses. */
export function escapeCsvField(value: string): string {
  return NEEDS_QUOTING.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * RFC 4180 quoting PLUS formula neutralisation. Use for any file a person opens
 * in a spreadsheet — which is every export except a machine-ingested feed.
 *
 * A neutralised cell is ALWAYS quoted, not just prefixed. Excel only honours the
 * leading apostrophe as a text marker inside a quoted field; left bare it can be
 * shown literally or, worse, dropped so the formula fires anyway.
 */
export function escapeCsvCell(value: string): string {
  if (FORMULA_LEAD.test(value) && !PLAIN_NUMBER.test(value)) {
    return `"'${value.replace(/"/g, '""')}"`;
  }
  return escapeCsvField(value);
}

/** Render an arbitrary value as a cell: objects as JSON, null/undefined as ''. */
export function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return escapeCsvCell(typeof value === 'object' ? JSON.stringify(value) : String(value));
}

/** Join pre-stringified values into one formula-safe CSV row. */
export function csvRow(values: readonly unknown[]): string {
  return values.map(toCsvCell).join(',');
}
