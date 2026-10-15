import { csvRow } from '@myclash/types';

/**
 * The text of a CSV file built in the browser (quick win O20): the byte-order mark first, so
 * Excel reads "Géraldine" as written and not as "GÃ©raldine"; every cell formula-safe
 * (`csvRow` → `escapeCsvCell`); CRLF line ends, as RFC 4180 writes them. The ONE owner: every
 * file the organiser downloads from a page is made here.
 */
export function csvFile(rows: ReadonlyArray<readonly unknown[]>): string {
  return `\uFEFF${rows.map(csvRow).join('\r\n')}\r\n`;
}

/** Hand a CSV text to the browser as a download named `filename`. */
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
