/**
 * The line of the file a parsed CSV record STARTS on (the header is line 1).
 *
 * csv-parse gives, with `info: true` and `raw: true`, the line a record ENDS on
 * (`info.lines`) and the record's raw text: the blank lines skipped before it,
 * its own text, and its closing newline. The record's own newlines (a quoted
 * cell over several lines) are what separates its last line from its first.
 */
export function recordLine(endLine: number, raw: string): number {
  const own = raw.replace(/^(?:\r?\n)+/u, '').replace(/\r?\n$/u, '');
  return endLine - (own.match(/\n/gu)?.length ?? 0);
}
