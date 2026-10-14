/**
 * The line of the file a parsed CSV record STARTS on (the header is line 1).
 *
 * csv-parse gives, with `info: true` and `raw: true`, the line a record ENDS on
 * (`info.lines`) and the record's raw text: the blank lines skipped before it
 * (a line of spaces counts as blank), its own text, and its closing newline. The
 * record's own newlines (a quoted cell over several lines) are what separates its
 * last line from its first.
 */
export function recordLine(endLine: number, raw: string): number {
  const own = raw.replace(/^(?:[ \t]*\r?\n)+/u, '').replace(/\r?\n$/u, '');
  return endLine - (own.match(/\n/gu)?.length ?? 0);
}

/**
 * The line where a quote that is never closed opens, or null when every quote
 * closes. csv-parse names the LAST line of the file for that fault; the organiser
 * needs the line of the stray `"`.
 */
export function openQuoteLine(content: string): number | null {
  let line = 1;
  let openedOn: number | null = null;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === '\n') line += 1;
    else if (ch === '"' && openedOn !== null && content[i + 1] === '"') i += 1;
    else if (ch === '"') openedOn = openedOn === null ? line : null;
  }
  return openedOn;
}
