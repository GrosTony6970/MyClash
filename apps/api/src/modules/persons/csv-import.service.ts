import { Injectable, Logger } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import type { CsvImportReport } from '@myclash/types';

export interface CsvRow {
  given_name: string;
  family_name: string;
  display_name?: string;
  email?: string;
  club?: string;
  club_abv?: string;
  club_city?: string;
  hema_ratings_id?: string;
  event_codes?: string;
  roles?: string;
  is_fighter?: string;
  is_referee?: string;
  is_workshop_participant?: string;
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

      rows.push({
        rowNumber,
        given_name: givenName,
        family_name: familyName,
        display_name: (normalized['display_name'] ?? '').trim() || undefined,
        email: rawEmail || undefined,
        club: (normalized['club'] ?? '').trim() || undefined,
        club_abv: (normalized['club_abv'] ?? '').trim() || undefined,
        club_city: (normalized['club_city'] ?? '').trim() || undefined,
        hema_ratings_id: (normalized['hema_ratings_id'] ?? '').trim() || undefined,
        event_codes: (normalized['event_codes'] ?? '').trim() || undefined,
        roles: (normalized['roles'] ?? '').trim() || undefined,
        is_fighter: (normalized['is_fighter'] ?? '').trim() || undefined,
        is_referee: (normalized['is_referee'] ?? '').trim() || undefined,
        is_workshop_participant: (normalized['is_workshop_participant'] ?? '').trim() || undefined,
      });
    });

    return { rows, invalid };
  }

  /** Mask email for display: jean.dupont@gmail.com → j***@g***.com */
  maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***@***.***';
    const domainParts = domain.split('.');
    const tld = domainParts.pop() ?? '';
    const domainName = domainParts.join('.');
    return `${local[0]}***@${domainName[0] ?? ''}***.${tld}`;
  }
}
