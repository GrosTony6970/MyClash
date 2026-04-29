import { Injectable, Logger } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import type { CsvImportReport } from '@myclash/types';

export interface CsvRow {
  given_name: string;
  family_name: string;
  email: string;
  club?: string;
  hema_ratings_id?: string;
  event_codes?: string;
  roles?: string;
}

export interface ParsedCsvResult {
  rows: Array<CsvRow & { rowNumber: number }>;
  invalid: CsvImportReport['invalid'];
}

/**
 * Parses a CSV buffer into validated rows.
 * Handles: BOM, quoted commas, accented characters, missing optional columns.
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

    let rawRows: Record<string, string>[];
    try {
      rawRows = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
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
      const email = (normalized['email'] ?? '').trim().toLowerCase();

      // Validate required fields
      if (!givenName) {
        invalid.push({ row: rowNumber, reason: 'Missing given_name', raw: rawStr });
        return;
      }
      if (!familyName) {
        invalid.push({ row: rowNumber, reason: 'Missing family_name', raw: rawStr });
        return;
      }
      if (!email) {
        invalid.push({ row: rowNumber, reason: 'Missing email', raw: rawStr });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        invalid.push({ row: rowNumber, reason: `Invalid email: ${email}`, raw: rawStr });
        return;
      }

      rows.push({
        rowNumber,
        given_name: givenName,
        family_name: familyName,
        email,
        club: (normalized['club'] ?? '').trim() || undefined,
        hema_ratings_id: (normalized['hema_ratings_id'] ?? '').trim() || undefined,
        event_codes: (normalized['event_codes'] ?? '').trim() || undefined,
        roles: (normalized['roles'] ?? '').trim() || undefined,
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
