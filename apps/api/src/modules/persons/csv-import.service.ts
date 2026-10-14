import { Injectable, Logger } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { getDateFormat, type ImportRowProblem } from '@myclash/types';
import { recordLine } from './csv-lines';

export interface CsvRow {
  given_name: string;
  family_name: string;
  display_name?: string;
  email?: string;
  /** ISO YYYY-MM-DD; rejected as an invalid row if any other format. */
  date_of_birth?: string;
  club?: string;
  club_abv?: string;
  club_city?: string;
  hema_ratings_id?: string;
  /** Free-text gender/category label (persons.gender_category, global_persons.gender_category). */
  gender_category?: string;
  /** Organizer notes (event persons.notes only). */
  notes?: string;
  /** Pipe-separated weapons, first = favorite, optional level: "Longsword:intermediate|Rapier". */
  weapons?: string;
  event_codes?: string;
  roles?: string;
  is_fighter?: string;
  is_referee?: string;
  is_workshop_participant?: string;
}

/** Strict ISO calendar date (YYYY-MM-DD) — no time, no timezone. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize a CSV date cell to ISO YYYY-MM-DD. Preferred input is
 * DD/MM/YYYY (French organizer convention; matches the helper from
 * `getDateFormat('fr')`). ISO YYYY-MM-DD is accepted as a fallback
 * so historical organizer uploads keep working. Returns null when
 * the value is missing or matches neither shape (caller surfaces a
 * row-level invalid entry).
 *
 * MM/DD/YYYY is intentionally NOT auto-detected — it's ambiguous
 * with DD/MM/YYYY and we don't want silent mis-parses. English-
 * locale admins re-save the file as ISO before upload.
 */
function parseCsvDate(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fr = getDateFormat('fr').parse(trimmed);
  if (fr) return fr;
  if (ISO_DATE_RE.test(trimmed)) return trimmed;
  return null;
}

/** Where a record sits: its place among the file's rows (from 0) and its line (header = 1). */
export interface RowPlace {
  index: number;
  line: number;
}

export type InvalidCsvRow = RowPlace & ImportRowProblem & { raw: string };

export interface ParsedCsvResult {
  rows: Array<CsvRow & RowPlace>;
  invalid: InvalidCsvRow[];
}

/** A file csv-parse gave up on: one refusal, at the line where it stopped. */
function unreadableFile(err: unknown): ParsedCsvResult {
  const line = (err as { lines?: unknown }).lines;
  return {
    rows: [],
    invalid: [
      { index: 0, line: typeof line === 'number' ? line : 1, reason: 'unreadable_file', raw: '' },
    ],
  };
}

/** One record as csv-parse gives it with `info` and `raw`. */
interface ParsedRecord {
  record: Record<string, string>;
  info: { lines: number };
  raw: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A record's cells keyed by header (lower case, spaces as `_`), or why the record is refused. */
function checkRecord(cells: Record<string, string>): CsvRow | ImportRowProblem {
  const cell = (key: string) => (cells[key] ?? '').trim();
  const givenName = cell('given_name');
  const familyName = cell('family_name');
  const email = cell('email').toLowerCase();
  if (!givenName) return { reason: 'missing_given_name' };
  if (!familyName) return { reason: 'missing_family_name' };
  // Email is optional — validate format only when present
  if (email && !EMAIL_RE.test(email)) return { reason: 'invalid_email', value: email };
  // date_of_birth is optional — accept DD/MM/YYYY (preferred, French convention)
  // or ISO YYYY-MM-DD (legacy fallback) and normalize to ISO before downstream.
  // MM/DD/YYYY stays ambiguous and gets rejected — admins re-save as ISO.
  const rawDob = cell('date_of_birth');
  const isoDob = rawDob ? parseCsvDate(rawDob) : null;
  if (rawDob && !isoDob) return { reason: 'invalid_date_of_birth', value: rawDob };
  const optional = (key: string) => cell(key) || undefined;
  return {
    given_name: givenName,
    family_name: familyName,
    display_name: optional('display_name'),
    email: email || undefined,
    date_of_birth: isoDob ?? undefined,
    club: optional('club'),
    club_abv: optional('club_abv'),
    club_city: optional('club_city'),
    hema_ratings_id: optional('hema_ratings_id'),
    gender_category: optional('gender_category'),
    notes: optional('notes'),
    weapons: optional('weapons'),
    event_codes: optional('event_codes'),
    roles: optional('roles'),
    is_fighter: optional('is_fighter'),
    is_referee: optional('is_referee'),
    is_workshop_participant: optional('is_workshop_participant'),
  };
}

/**
 * Sniff the column separator from the first non-empty line of a CSV.
 * Returns ';' if semicolons strictly outnumber commas outside quoted fields;
 * otherwise ',' (the historical default and the assumed schema).
 */
export function detectCsvDelimiter(content: string): ',' | ';' {
  let text = content;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  let line = '';
  for (const candidate of text.split(/\r?\n/u)) {
    if (candidate.trim().length > 0) {
      line = candidate;
      break;
    }
  }
  if (!line) return ',';

  let inQuotes = false;
  let commas = 0;
  let semis = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === ',') commas += 1;
    else if (ch === ';') semis += 1;
  }

  return semis > commas ? ';' : ',';
}

/**
 * Parses a CSV buffer into validated rows.
 * Handles: BOM, quoted commas, accented characters, missing optional columns.
 * Email is optional. Club is expected but absence is valid (Unaffiliated).
 * Accepted columns: given_name, family_name, email, club, club_abv, club_city,
 *                   hema_ratings_id, event_codes, roles
 */
@Injectable()
export class CsvImportService {
  private readonly logger = new Logger(CsvImportService.name);

  parse(buffer: Buffer): ParsedCsvResult {
    // Strip BOM if present
    let content = buffer.toString('utf-8');
    if (content.charCodeAt(0) === 0xfeff) {
      content = content.slice(1);
    }

    let records: ParsedRecord[];
    try {
      records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
        delimiter: detectCsvDelimiter(content),
        info: true,
        raw: true,
      }) as ParsedRecord[];
    } catch (err) {
      this.logger.warn(`CSV parse error: ${String(err)}`);
      return unreadableFile(err);
    }

    const rows: ParsedCsvResult['rows'] = [];
    const invalid: ParsedCsvResult['invalid'] = [];
    records.forEach(({ record, info, raw }, index) => {
      const place = { index, line: recordLine(info.lines, raw) };
      // Normalize column names (handle case variations)
      const cells: Record<string, string> = {};
      for (const [k, v] of Object.entries(record)) {
        cells[k.toLowerCase().trim().replace(/\s+/g, '_')] = v ?? '';
      }
      const checked = checkRecord(cells);
      if ('reason' in checked) {
        invalid.push({ ...place, ...checked, raw: Object.values(record).join(',') });
      } else {
        rows.push({ ...place, ...checked });
      }
    });

    return { rows, invalid };
  }

  /**
   * Mask email for display: jean.dupont@gmail.com → j***@g***.com
   *
   * `persons.email` is nullable in the schema, so callers (e.g. the public
   * lookup endpoint) can legitimately pass null/undefined/'' here. Return
   * an empty string in those cases — the UI renders blank where it would
   * have shown the masked address.
   */
  maskEmail(email: string | null | undefined): string {
    if (!email) return '';
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***@***.***';
    const domainParts = domain.split('.');
    const tld = domainParts.pop() ?? '';
    const domainName = domainParts.join('.');
    return `${local[0]}***@${domainName[0] ?? ''}***.${tld}`;
  }
}
