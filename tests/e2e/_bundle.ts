/**
 * Readers for the files MyClash hands out: STORED zips and CSV bodies.
 *
 * Extracted from `12-exports.spec.ts` once the privacy spec needed the same
 * three things. Deliberately dependency-free — the e2e runner resolves
 * workspace packages poorly, and every zip the API produces goes through
 * `apps/api/src/common/stored-zip.ts`, which writes method-0 entries with no
 * extra field. That is spec-legal, every unzip implementation reads it, and it
 * means a ~15-line local-header walk is all a test needs.
 */

/**
 * One CSV row's fields, honouring RFC 4180 quoting.
 *
 * A naive `split(',')` miscounts fields on exactly the rows that matter most:
 * the human-facing exports QUOTE any cell they formula-neutralise.
 */
export function splitCsvRow(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      fields.push(field);
      field = '';
    } else field += char;
  }
  fields.push(field);
  return fields;
}

/** Non-empty lines of a CSV body. */
export const linesOf = (csv: string): string[] => csv.split('\n').filter((line) => line.length > 0);

/**
 * Rows of a CSV with a header line, keyed by column name.
 *
 * For the subject-export bundle, whose files merge several tables and so carry
 * the UNION of their columns — a positional read would drift per file.
 */
export function parseCsvRows(csv: string): Array<Record<string, string>> {
  const lines = linesOf(csv);
  if (lines.length === 0) return [];
  const header = splitCsvRow(lines[0]!);
  return lines.slice(1).map((line) => {
    const fields = splitCsvRow(line);
    return Object.fromEntries(header.map((column, index) => [column, fields[index] ?? '']));
  });
}

/**
 * A value as `escapeCsvCell` leaves it once the RFC quoting is parsed back off:
 * a formula-leading cell keeps the apostrophe that makes it literal text.
 *
 * The apostrophe is the PAYLOAD, not the quoting — a test that parses the CSV
 * and compares to the original value will differ by that one character, and the
 * export is the one that is right.
 */
export const neutralisedForSpreadsheet = (value: string): string =>
  /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

/**
 * Entry name → text, for the STORED (method 0) zips `createStoredZip` writes.
 *
 * Walks the local file headers rather than the central directory: every entry is
 * uncompressed with no extra field, so the sizes in the local header are exact.
 */
export function readStoredZip(buffer: Buffer): Map<string, string> {
  const entries = new Map<string, string>();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.set(
      buffer.subarray(nameStart, nameStart + nameLength).toString('utf8'),
      buffer.subarray(dataStart, dataStart + size).toString('utf8'),
    );
    offset = dataStart + size;
  }
  return entries;
}
