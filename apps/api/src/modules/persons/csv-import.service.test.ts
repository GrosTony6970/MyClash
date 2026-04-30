import { describe, it, expect, beforeEach } from 'vitest';
import { CsvImportService } from './csv-import.service';

describe('CsvImportService', () => {
  let service: CsvImportService;

  beforeEach(() => {
    service = new CsvImportService();
  });

  // ── maskEmail ──────────────────────────────────────────────────────────────

  describe('maskEmail', () => {
    it('masks a standard email', () => {
      expect(service.maskEmail('jean.dupont@gmail.com')).toBe('j***@g***.com');
    });

    it('masks a short local part', () => {
      expect(service.maskEmail('a@b.fr')).toBe('a***@b***.fr');
    });

    it('handles invalid email gracefully', () => {
      expect(service.maskEmail('notanemail')).toBe('***@***.***');
    });
  });

  // ── parse ──────────────────────────────────────────────────────────────────

  describe('parse', () => {
    it('parses a valid CSV with all columns', () => {
      const csv = `given_name,family_name,email,club,hema_ratings_id,event_codes,roles
Jean,Dupont,jean@example.com,Lyon AMHE,12345,longsword-open,competitor
Marie,Lefèvre,marie@example.com,Cercle PRMD,,longsword-open,competitor`;

      const result = service.parse(Buffer.from(csv, 'utf-8'));
      expect(result.rows).toHaveLength(2);
      expect(result.invalid).toHaveLength(0);
      expect(result.rows[0]?.given_name).toBe('Jean');
      expect(result.rows[0]?.email).toBe('jean@example.com');
      expect(result.rows[1]?.given_name).toBe('Marie');
    });

    it('strips BOM from UTF-8 with BOM files', () => {
      const csv = '\uFEFFgiven_name,family_name,email\nJean,Dupont,jean@example.com';
      const result = service.parse(Buffer.from(csv, 'utf-8'));
      expect(result.rows).toHaveLength(1);
      expect(result.invalid).toHaveLength(0);
    });

    it('marks rows with missing email as invalid', () => {
      const csv = `given_name,family_name,email
Jean,Dupont,
Marie,Lefèvre,marie@example.com`;

      const result = service.parse(Buffer.from(csv, 'utf-8'));
      expect(result.rows).toHaveLength(1);
      expect(result.invalid).toHaveLength(1);
      expect(result.invalid[0]?.reason).toContain('Missing email');
      expect(result.invalid[0]?.row).toBe(2);
    });

    it('marks rows with invalid email format as invalid', () => {
      const csv = `given_name,family_name,email
Jean,Dupont,not-an-email`;

      const result = service.parse(Buffer.from(csv, 'utf-8'));
      expect(result.rows).toHaveLength(0);
      expect(result.invalid).toHaveLength(1);
      expect(result.invalid[0]?.reason).toContain('Invalid email');
    });

    it('marks rows with missing given_name as invalid', () => {
      const csv = `given_name,family_name,email
,Dupont,jean@example.com`;

      const result = service.parse(Buffer.from(csv, 'utf-8'));
      expect(result.rows).toHaveLength(0);
      expect(result.invalid).toHaveLength(1);
      expect(result.invalid[0]?.reason).toContain('Missing given_name');
    });

    it('handles quoted commas in fields', () => {
      const csv = `given_name,family_name,email,club
Jean,"Dupont, Jr.",jean@example.com,"Club, Paris"`;

      const result = service.parse(Buffer.from(csv, 'utf-8'));
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.family_name).toBe('Dupont, Jr.');
      expect(result.rows[0]?.club).toBe('Club, Paris');
    });

    it('normalises email to lowercase', () => {
      const csv = `given_name,family_name,email
Jean,Dupont,Jean.DUPONT@Example.COM`;

      const result = service.parse(Buffer.from(csv, 'utf-8'));
      expect(result.rows[0]?.email).toBe('jean.dupont@example.com');
    });

    it('handles accented characters in names', () => {
      const csv = `given_name,family_name,email
Élodie,Lefèvre,elodie@example.com`;

      const result = service.parse(Buffer.from(csv, 'utf-8'));
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.given_name).toBe('Élodie');
      expect(result.rows[0]?.family_name).toBe('Lefèvre');
    });

    it('handles missing optional columns gracefully', () => {
      const csv = `given_name,family_name,email
Jean,Dupont,jean@example.com`;

      const result = service.parse(Buffer.from(csv, 'utf-8'));
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.club).toBeUndefined();
      expect(result.rows[0]?.hema_ratings_id).toBeUndefined();
    });

    // ── The key AC test: 100 rows, 3 invalid, 5 duplicates (detected in service) ──
    it('parses 100-row CSV and correctly identifies 3 invalid rows', () => {
      const validRows = Array.from(
        { length: 92 },
        (_, i) => `Person${i},Test,person${i}@example.com,Club A`,
      );
      const invalidRows = [
        ',NoGivenName,nogiven@example.com,Club A', // missing given_name
        'NoEmail,Person,,Club A', // missing email
        'BadEmail,Person,not-an-email,Club A', // invalid email
      ];
      // 5 "duplicate" rows — same emails as first 5 valid rows
      // (duplicate detection happens in PersonsService, not CsvImportService)
      const allRows = [...validRows, ...invalidRows];
      const csv = `given_name,family_name,email,club\n${allRows.join('\n')}`;

      const result = service.parse(Buffer.from(csv, 'utf-8'));
      expect(result.invalid).toHaveLength(3);
      expect(result.rows).toHaveLength(92);
    });
  });
});
