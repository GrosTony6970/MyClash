import { Injectable, Logger } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { getDateFormat, type CsvImportReport } from '@myclash/types';

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

export interface ParsedCsvResult {
  rows: Array<CsvRow & { rowNumber: number }>;
  invalid: CsvImportReport['invalid'];
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

    const delimiter = detectCsvDelimiter(content);

    let rawRows: Record<string, string>[];
    try {
      rawRows = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
        delimiter,
      }) as Record<string, string>[];
    } catch (err) {
      this.logger.error(`CSV parse error: ${String(err)}`);
      return {
        rows: [],
        invalid: [{ row: 0, reason: `CSV parse error: ${String(err)}`, raw: '' }],
      };
    }

    const rows: ParsedCsvResult['rows'] = [];
    const invalid: CsvImportReport['invalid'] = [];

    rawRows.forEach((raw, idx) => {
      const rowNumber = idx + 2; // 1-indexed, +1 for header row
      const rawStr = Object.values(raw).join(',');

      // Normalize column names (handle case variations)
      const normalized: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        normalized[k.toLowerCase().trim().replace(/\s+/g, '_')] = v ?? '';
      }

      const givenName = (normalized['given_name'] ?? '').trim();
      const familyName = (normalized['family_name'] ?? '').trim();
      const rawEmail = (normalized['email'] ?? '').trim().toLowerCase();

      if (!givenName) {
        invalid.push({ row: rowNumber, reason: 'Missing given_name', raw: rawStr });
        return;
      }
      if (!familyName) {
        invalid.push({ row: rowNumber, reason: 'Missing family_name', raw: rawStr });
        return;
      }

      // Email is optional — validate format only when present
      if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        invalid.push({ row: rowNumber, reason: `Invalid email: ${rawEmail}`, raw: rawStr });
        return;
      }

      // date_of_birth is optional — accept DD/MM/YYYY (preferred,
      // French convention) or ISO YYYY-MM-DD (legacy fallback) and
      // normalize to ISO before downstream. MM/DD/YYYY stays
      // ambiguous and gets rejected — admins re-save as ISO.
      const rawDob = (normalized['date_of_birth'] ?? '').trim();
      let isoDob: string | undefined;
      if (rawDob) {
        const parsed = parseCsvDate(rawDob);
        if (!parsed) {
          invalid.push({
            row: rowNumber,
            reason: `Invalid date_of_birth: ${rawDob} (expected DD/MM/YYYY)`,
            raw: rawStr,
          });
          return;
        }
        isoDob = parsed;
      }

      rows.push({
        rowNumber,
        given_name: givenName,
        family_name: familyName,
        display_name: (normalized['display_name'] ?? '').trim() || undefined,
        email: rawEmail || undefined,
        date_of_birth: isoDob,
        club: (normalized['club'] ?? '').trim() || undefined,
        club_abv: (normalized['club_abv'] ?? '').trim() || undefined,
        club_city: (normalized['club_city'] ?? '').trim() || undefined,
        hema_ratings_id: (normalized['hema_ratings_id'] ?? '').trim() || undefined,
        gender_category: (normalized['gender_category'] ?? '').trim() || undefined,
        notes: (normalized['notes'] ?? '').trim() || undefined,
        weapons: (normalized['weapons'] ?? '').trim() || undefined,
        event_codes: (normalized['event_codes'] ?? '').trim() || undefined,
        roles: (normalized['roles'] ?? '').trim() || undefined,
        is_fighter: (normalized['is_fighter'] ?? '').trim() || undefined,
        is_referee: (normalized['is_referee'] ?? '').trim() || undefined,
        is_workshop_participant: (normalized['is_workshop_participant'] ?? '').trim() || undefined,
      });
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
