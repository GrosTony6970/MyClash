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

/**
 * How a spreadsheet splits a row into cells and writes a decimal. French Excel splits on `;` and
 * reads `12,50` as a number (operator, 2026-10-15): given a comma file it puts every value in the
 * first column, and given `12.50` it reads text a total skips.
 */
export interface CsvFormat {
  separator: ',' | ';';
  decimal: '.' | ',';
}

/** RFC 4180, as English Excel, LibreOffice and Google Sheets read it. Frozen. */
export const CSV_STANDARD: Readonly<CsvFormat> = Object.freeze({ separator: ',', decimal: '.' });

/** As French Excel reads it. */
export const CSV_EXCEL_FR: Readonly<CsvFormat> = Object.freeze({ separator: ';', decimal: ',' });

/*
 * The rules below take the file's separator, and stay private. The three exported escapers take
 * ONE value and pass `,`: callers hand them to `map` point-free (`row.map(escapeCsvField)` in the
 * HEMA Ratings feed), and `map` passes its index as the second argument. A separator parameter
 * on them read 0, 1, 2… and stopped quoting the commas of that feed.
 */

/** RFC 4180: quoted when the cell holds a quote, a line end, or the file's separator. */
function quotedIfNeeded(value: string, separator: CsvFormat['separator']): string {
  const needs =
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    value.includes(separator);
  return needs ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * RFC 4180 quoting PLUS formula neutralisation. A neutralised cell is ALWAYS quoted, not just
 * prefixed. Excel only honours the leading apostrophe as a text marker inside a quoted field;
 * left bare it can be shown literally or, worse, dropped so the formula fires anyway.
 */
function neutralised(value: string, separator: CsvFormat['separator']): string {
  if (FORMULA_LEAD.test(value) && !PLAIN_NUMBER.test(value)) {
    return `"'${value.replace(/"/g, '""')}"`;
  }
  return quotedIfNeeded(value, separator);
}

/**
 * A value as a cell of `format`: objects as JSON, null/undefined as ''. A plain number is written
 * with the format's decimal mark; it holds no quote and no `;`, so it needs no quotes. Text that
 * is exactly a decimal (a Pool named "1.1", a Workshop level "1.5") is written so too, on
 * purpose: French Excel then reads the same number the organiser typed.
 */
function cellOf(value: unknown, format: CsvFormat): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (format.decimal === ',' && PLAIN_NUMBER.test(text)) return text.replace('.', ',');
  return neutralised(text, format.separator);
}

/** RFC 4180 quoting only. Use for feeds another system parses. */
export function escapeCsvField(value: string): string {
  return quotedIfNeeded(value, ',');
}

/**
 * RFC 4180 quoting PLUS formula neutralisation. Use for any file a person opens
 * in a spreadsheet — which is every export except a machine-ingested feed.
 */
export function escapeCsvCell(value: string): string {
  return neutralised(value, ',');
}

/** Render an arbitrary value as a cell: objects as JSON, null/undefined as ''. */
export function toCsvCell(value: unknown): string {
  return cellOf(value, CSV_STANDARD);
}

/** Join values into one formula-safe CSV row of `format`. */
export function csvRow(values: readonly unknown[], format: CsvFormat): string {
  return values.map((value) => cellOf(value, format)).join(format.separator);
}

/**
 * The text of a CSV file a person downloads, built by a page or by the server: the byte-order
 * mark first, so Excel reads "Géraldine" as written and not as "GÃ©raldine"; every cell
 * formula-safe; CRLF line ends, as RFC 4180 writes them. The ONE owner of that file's shape.
 */
export function csvFile(rows: ReadonlyArray<readonly unknown[]>, format: CsvFormat): string {
  return `\uFEFF${rows.map((row) => csvRow(row, format)).join('\r\n')}\r\n`;
}

/** How a download link names the file it asks for (`?csv=`): a page and the server read one list. */
export const CSV_FORMAT_PARAMS = ['excel-fr', 'standard'] as const;

export type CsvFormatParam = (typeof CSV_FORMAT_PARAMS)[number];

export function csvFormatParam(format: Readonly<CsvFormat>): CsvFormatParam {
  return format.separator === ';' ? 'excel-fr' : 'standard';
}

export function csvFormatFromParam(param: CsvFormatParam): Readonly<CsvFormat> {
  return param === 'excel-fr' ? CSV_EXCEL_FR : CSV_STANDARD;
}
