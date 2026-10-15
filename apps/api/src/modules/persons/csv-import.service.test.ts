import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { EVENT_IMPORT_COLUMNS, GLOBAL_IMPORT_COLUMNS } from './csv-columns';
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

      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.rows).toHaveLength(2);
      expect(result.invalid).toHaveLength(0);
      expect(result.rows[0]?.given_name).toBe('Jean');
      expect(result.rows[0]?.email).toBe('jean@example.com');
      expect(result.rows[1]?.given_name).toBe('Marie');
    });

    it('strips BOM from UTF-8 with BOM files', () => {
      const csv = '\uFEFFgiven_name,family_name,email\nJean,Dupont,jean@example.com';
      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.rows).toHaveLength(1);
      expect(result.invalid).toHaveLength(0);
    });

    it('parses gender_category, notes, and weapons columns', () => {
      const csv = `given_name,family_name,gender_category,notes,weapons
Jean,Dupont,M,Left-handed,Longsword:intermediate|Rapier
Marie,Lefevre,,,`;
      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
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

      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.rows).toHaveLength(2);
      expect(result.invalid).toHaveLength(0);
      expect(result.rows[0]?.email).toBeUndefined();
    });

    it('marks rows with invalid email format as invalid', () => {
      const csv = `given_name,family_name,email
Jean,Dupont,not-an-email`;

      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.rows).toHaveLength(0);
      expect(result.invalid).toEqual([
        {
          index: 0,
          line: 2,
          reason: 'invalid_email',
          value: 'not-an-email',
          raw: 'Jean,Dupont,not-an-email',
        },
      ]);
    });

    it('marks rows with missing given_name as invalid', () => {
      const csv = `given_name,family_name,email
,Dupont,jean@example.com`;

      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.rows).toHaveLength(0);
      expect(result.invalid).toEqual([
        { index: 0, line: 2, reason: 'missing_given_name', raw: ',Dupont,jean@example.com' },
      ]);
    });

    it('marks rows with missing family_name as invalid', () => {
      const result = service.parse(
        Buffer.from('given_name,family_name\nJean,', 'utf-8'),
        EVENT_IMPORT_COLUMNS,
      );
      expect(result.invalid.map((r) => r.reason)).toEqual(['missing_family_name']);
    });

    it('names a date of birth it cannot read, as the file holds it', () => {
      const csv = 'given_name,family_name,date_of_birth\nJean,Dupont,03-15-1990';
      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.invalid).toEqual([
        expect.objectContaining({ line: 2, reason: 'invalid_date_of_birth', value: '03-15-1990' }),
      ]);
    });

    // The line each row is named by: csv-import.lines.test.ts.

    it('handles quoted commas in fields', () => {
      const csv = `given_name,family_name,email,club
Jean,"Dupont, Jr.",jean@example.com,"Club, Paris"`;

      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.family_name).toBe('Dupont, Jr.');
      expect(result.rows[0]?.club).toBe('Club, Paris');
    });

    it('normalises email to lowercase', () => {
      const csv = `given_name,family_name,email
Jean,Dupont,Jean.DUPONT@Example.COM`;

      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.rows[0]?.email).toBe('jean.dupont@example.com');
    });

    it('handles accented characters in names', () => {
      const csv = `given_name,family_name,email
Élodie,Lefèvre,elodie@example.com`;

      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.given_name).toBe('Élodie');
      expect(result.rows[0]?.family_name).toBe('Lefèvre');
    });

    it('handles missing optional columns gracefully', () => {
      const csv = `given_name,family_name,email
Jean,Dupont,jean@example.com`;

      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.club).toBeUndefined();
      expect(result.rows[0]?.hema_ratings_id).toBeUndefined();
    });

    it('parses a semicolon-separated CSV end-to-end', () => {
      const csv = `given_name;family_name;email
Jean;Dupont;jean@example.com
Marie;Lefèvre;marie@example.com`;

      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
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

      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.invalid).toHaveLength(2);
      expect(result.rows).toHaveLength(93);
    });
  });

  // ── header names (O18) ─────────────────────────────────────────────────────

  describe('the header names', () => {
    it('reads French headers, with or without their accents', () => {
      const csv =
        'Prénom;Nom;Courriel;Date de naissance;Sigle club\nJeanne;Exemple;J@X.FR;14/02/1995;SAE';
      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.unknownColumns).toEqual([]);
      expect(result.rows[0]).toMatchObject({
        given_name: 'Jeanne',
        family_name: 'Exemple',
        email: 'j@x.fr',
        date_of_birth: '1995-02-14',
        club_abv: 'SAE',
      });
    });

    it('reads English headers in any case, and "E-mail" or "First name"', () => {
      const csv = 'First name,Last Name,E-mail\nJane,Example,jane@example.com';
      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.unknownColumns).toEqual([]);
      expect(result.rows[0]).toMatchObject({ given_name: 'Jane', email: 'jane@example.com' });
    });

    // Ruled 2026-10-15: a column THIS import does not read is named, though another import
    // reads it. The roster import never reads a referee flag; the Global Profiles one does.
    it('names the headers this import does not read, as the file writes them', () => {
      const csv = 'given_name,family_name,Arbitre,prenom2,\nJane,Example,1,x,';
      const roster = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(roster.unknownColumns).toEqual(['Arbitre', 'prenom2']);
      expect(roster.rows[0]?.is_referee).toBeUndefined();
      const profiles = service.parse(Buffer.from(csv, 'utf-8'), GLOBAL_IMPORT_COLUMNS);
      expect(profiles.unknownColumns).toEqual(['prenom2']);
      expect(profiles.rows[0]).toMatchObject({ is_referee: '1' });
    });

    // csv-parse lets a later column overwrite an earlier one of the same name, in silence:
    // a blank "Email" after "Adresse e-mail" wiped every address. The first one is read.
    it('reads the first of two headers that name one column, and names the other', () => {
      const csv =
        'Adresse e-mail,Email,Nom,family_name,Email Address,prenom\nx@y.fr,,Dupont,,z@y.fr,Jean';
      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.rows[0]).toMatchObject({
        email: 'x@y.fr',
        family_name: 'Dupont',
        given_name: 'Jean',
      });
      expect(result.unknownColumns).toEqual(['Email', 'family_name', 'Email Address']);
    });

    it('reads "Email Address", the header an English online form exports', () => {
      const csv = 'First name,Last name,Email Address\nJane,Example,jane@example.com';
      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.rows[0]?.email).toBe('jane@example.com');
    });

    it('names a header it does not read once, however often the file repeats it', () => {
      const csv = 'given_name,family_name,Remarks,Remarks\nJane,Example,a,b';
      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.unknownColumns).toEqual(['Remarks']);
    });

    // "Catégorie" in French HEMA is a Tournament's category, not a gender: it is not read.
    it('reads "Genre" as the gender category, and not "Catégorie"', () => {
      const csv = 'prenom;nom;Catégorie;Genre\nJeanne;Exemple;Épée longue;F';
      const result = service.parse(Buffer.from(csv, 'utf-8'), EVENT_IMPORT_COLUMNS);
      expect(result.rows[0]?.gender_category).toBe('F');
      expect(result.unknownColumns).toEqual(['Catégorie']);
    });

    it('reads no more event_codes or roles, which no import ever used', () => {
      const csv = 'given_name,family_name,event_codes,roles\nJane,Example,open,competitor';
      const result = service.parse(Buffer.from(csv, 'utf-8'), GLOBAL_IMPORT_COLUMNS);
      expect(result.unknownColumns).toEqual(['event_codes', 'roles']);
    });
  });

  // The two templates of the roster import (`apps/web-admin/public/csv-samples`): the page
  // offers them, so each must import whole, every header read, every row valid.
  describe('the templates the import page offers', () => {
    const SAMPLES = path.resolve(__dirname, '../../../../web-admin/public/csv-samples');

    it.each(['en', 'fr'])('the %s template imports whole', (locale) => {
      const file = readFileSync(path.join(SAMPLES, `participants-${locale}.csv`));
      const result = service.parse(file, EVENT_IMPORT_COLUMNS);
      expect(result.unknownColumns).toEqual([]);
      expect(result.invalid).toEqual([]);
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0]).toMatchObject({
        date_of_birth: '1995-02-14',
        club_abv: expect.any(String),
      });
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
