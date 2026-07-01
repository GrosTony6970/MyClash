import { describe, it, expect, beforeEach } from 'vitest';
import { CsvImportService, detectCsvDelimiter } from './csv-import.service';

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

    // Regression net for Sentry "Cannot read properties of null (reading 'split')"
    // on /events/:eventId/persons/lookup. persons.email is nullable; the masker
    // was crashing on the null path before.
    it('returns empty string when email is null', () => {
      expect(service.maskEmail(null)).toBe('');
    });

    it('returns empty string when email is undefined', () => {
      expect(service.maskEmail(undefined)).toBe('');
    });

    it('returns empty string when email is the empty string', () => {
      expect(service.maskEmail('')).toBe('');
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

    it('parses gender_category, notes, and weapons columns', () => {
      const csv = `given_name,family_name,gender_category,notes,weapons
Jean,Dupont,M,Left-handed,Longsword:intermediate|Rapier
Marie,Lefevre,,,`;
      const result = service.parse(Buffer.from(csv, 'utf-8'));
      expect(result.invalid).toHaveLength(0);
      expect(result.rows[0]?.gender_category).toBe('M');
      expect(result.rows[0]?.notes).toBe('Left-handed');
      expect(result.rows[0]?.weapons).toBe('Longsword:intermediate|Rapier');
      // blank optional cells stay undefined (not empty strings)
      expect(result.rows[1]?.gender_category).toBeUndefined();
      expect(result.rows[1]?.notes).toBeUndefined();
      expect(result.rows[1]?.weapons).toBeUndefined();
    });

    it('accepts rows with missing email', () => {
      const csv = `given_name,family_name,email
Jean,Dupont,
Marie,Lefèvre,marie@example.com`;

      const result = service.parse(Buffer.from(csv, 'utf-8'));
      expect(result.rows).toHaveLength(2);
      expect(result.invalid).toHaveLength(0);
      expect(result.rows[0]?.email).toBeUndefined();
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

    it('parses a semicolon-separated CSV end-to-end', () => {
      const csv = `given_name;family_name;email
Jean;Dupont;jean@example.com
Marie;Lefèvre;marie@example.com`;

      const result = service.parse(Buffer.from(csv, 'utf-8'));
      expect(result.rows).toHaveLength(2);
      expect(result.invalid).toHaveLength(0);
      expect(result.rows[0]?.given_name).toBe('Jean');
      expect(result.rows[0]?.email).toBe('jean@example.com');
      expect(result.rows[1]?.family_name).toBe('Lefèvre');
    });

    // ── The key AC test: 100 rows, 3 invalid, 5 duplicates (detected in service) ──
    it('parses 100-row CSV and correctly identifies invalid rows', () => {
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
      expect(result.invalid).toHaveLength(2);
      expect(result.rows).toHaveLength(93);
    });
  });

  // ── detectCsvDelimiter ─────────────────────────────────────────────────────

  describe('detectCsvDelimiter', () => {
    it('detects comma from a comma-separated header', () => {
      expect(detectCsvDelimiter('given_name,family_name,email\nJean,Dupont,j@x.co')).toBe(',');
    });

    it('detects semicolon from a semicolon-separated header', () => {
      expect(detectCsvDelimiter('given_name;family_name;email\nJean;Dupont;j@x.co')).toBe(';');
    });

    it('strips a leading BOM before sniffing', () => {
      expect(detectCsvDelimiter('﻿given_name;family_name;email')).toBe(';');
    });

    it('ignores separator characters inside quoted fields', () => {
      // Header has 1 comma inside quotes and 2 semicolons outside → semicolon wins
      expect(detectCsvDelimiter('"a,b";c;d')).toBe(';');
    });

    it('handles RFC 4180 escaped quotes inside quoted fields', () => {
      // "" inside the quoted field is a literal quote; the comma stays in-quotes
      expect(detectCsvDelimiter('"a""b,c";d;e')).toBe(';');
    });

    it('falls back to comma for a single-column file', () => {
      expect(detectCsvDelimiter('given_name\nJean\nMarie')).toBe(',');
    });

    it('falls back to comma for empty input', () => {
      expect(detectCsvDelimiter('')).toBe(',');
    });

    it('falls back to comma on a tie', () => {
      expect(detectCsvDelimiter('a,b;c')).toBe(',');
    });

    it('skips blank leading lines', () => {
      expect(detectCsvDelimiter('\n\n   \ngiven_name;family_name;email')).toBe(';');
    });
  });
});
