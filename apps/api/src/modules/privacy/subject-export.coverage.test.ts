import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SUBJECT_EXPORT_COLLECTED_TABLES,
  SUBJECT_EXPORT_EXCLUDED_TABLES,
} from './subject-export.tables';

/**
 * Anti-rot guard for the GDPR subject export.
 *
 * Art. 15 obliges us to hand over everything we hold about a person. The export
 * only carries the tables wired into SUBJECT_EXPORT_TABLES, so a table added to
 * the schema without a thought is a table quietly missing from every subject
 * access request — a compliance failure that looks exactly like a complete
 * export.
 *
 * This scans every migration for user-identifying columns and asserts each
 * table is CONSCIOUSLY either exported or listed in
 * SUBJECT_EXPORT_EXCLUDED_TABLES. Directly mirrors
 * ../exports/archive.migration-coverage.test.ts, which does the same job for
 * event-scoped tables.
 */

function findMigrationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), '../../packages/db/migrations'), // cwd = apps/api
    path.resolve(process.cwd(), 'packages/db/migrations'), // cwd = repo root
    path.resolve(__dirname, '../../../../packages/db/migrations'),
    path.resolve(__dirname, '../../../../../packages/db/migrations'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not locate packages/db/migrations (looked in: ${candidates.join(', ')})`);
}

function loadMigrationSql(): string {
  const dir = findMigrationsDir();
  return readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => readFileSync(path.join(dir, file), 'utf8'))
    .join('\n');
}

/**
 * Two independent nets, because either alone leaks.
 *
 * NAME catches `*user_id` (auth uid) and `*person_id` (a global_persons.id or
 * the event-scoped persons.id — the export decides which, see SubjectReach).
 *
 * FK catches columns that point at a person under a name the first net cannot
 * guess. `matches.referee_id` is the proof this is needed: it REFERENCES
 * persons(id), carries no `person_id` in its name, and spans two lines in
 * migration 0039, so a name-only, line-anchored scan misses it silently.
 *
 * Deliberately broad: a false positive costs one line in the excluded set, a
 * false negative costs a silent compliance gap.
 */
const SUBJECT_COLUMN_RE = /\b\w*(?:user_id|person_id)\b/i;
const PERSON_FK_RE = /references\s+(?:public\.)?"?(?:persons|global_persons|fighters)"?\s*\(/i;

/** Table names carrying at least one subject-identifying column. */
function subjectTablesFromMigrations(sql: string): { subject: Set<string>; all: Set<string> } {
  const subject = new Set<string>();
  const all = new Set<string>();

  // CREATE TABLE [IF NOT EXISTS] [public.]"name" ( ...body... \n);
  const createRe =
    /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\);/gi;
  let match: RegExpExecArray | null;
  while ((match = createRe.exec(sql)) !== null) {
    const name = match[1]!.toLowerCase();
    const body = match[2]!;
    all.add(name);
    // Column definitions are comma-separated; a FK must be inside one of them,
    // which keeps a table-level REFERENCES from tainting every column.
    const hasPersonFk = body.split(',').some((definition) => PERSON_FK_RE.test(definition));
    if (SUBJECT_COLUMN_RE.test(body) || hasPersonFk) subject.add(name);
  }

  // ALTER TABLE name ... ADD COLUMN [IF NOT EXISTS] <col>, by name or by person FK.
  // Statement-scoped (split on ';') so the FK cannot bind to a neighbouring one.
  for (const statement of sql.split(';')) {
    const alter = /ALTER TABLE\s+(?:public\.)?"?(\w+)"?/i.exec(statement);
    if (!alter) continue;
    const addsSubjectName = /ADD COLUMN(?:\s+IF NOT EXISTS)?\s+\w*(?:user_id|person_id)\b/i.test(
      statement,
    );
    const addsPersonFk =
      /ADD COLUMN(?:\s+IF NOT EXISTS)?\s+\w+/i.test(statement) && PERSON_FK_RE.test(statement);
    if (addsSubjectName || addsPersonFk) subject.add(alter[1]!.toLowerCase());
  }

  return { subject, all };
}

describe('subject export migration coverage', () => {
  const sql = loadMigrationSql();
  const { subject, all } = subjectTablesFromMigrations(sql);

  it('finds a meaningful set of subject tables (sanity check on the scanner)', () => {
    // If the regex breaks, this catches it before the real assertion misleads.
    expect(all.has('persons')).toBe(true);
    expect(all.has('audit_log')).toBe(true);
    expect(subject.has('follows')).toBe(true);
    expect(subject.size).toBeGreaterThan(20);
  });

  it('every subject-identifying table is either exported or explicitly excluded', () => {
    const unbucketed = [...subject]
      .filter(
        (table) =>
          !SUBJECT_EXPORT_COLLECTED_TABLES.has(table) && !SUBJECT_EXPORT_EXCLUDED_TABLES.has(table),
      )
      .sort();

    expect(
      unbucketed,
      `These tables carry a user/person id but are neither exported to the data ` +
        `subject nor listed in SUBJECT_EXPORT_EXCLUDED_TABLES. Art. 15 obliges us ` +
        `to disclose what we hold: add each to SUBJECT_EXPORT_TABLES, or exclude ` +
        `it WITH A REASON explaining why it is not about the subject:\n` +
        unbucketed.map((t) => `  - ${t}`).join('\n'),
    ).toEqual([]);
  });

  it('excluded tables are real tables (guards against typos / dead entries)', () => {
    const unknown = [...SUBJECT_EXPORT_EXCLUDED_TABLES].filter((table) => !all.has(table)).sort();
    expect(unknown, `SUBJECT_EXPORT_EXCLUDED_TABLES names tables no migration creates`).toEqual([]);
  });

  it('no table is both exported and excluded', () => {
    const overlap = [...SUBJECT_EXPORT_COLLECTED_TABLES].filter((table) =>
      SUBJECT_EXPORT_EXCLUDED_TABLES.has(table),
    );
    expect(overlap).toEqual([]);
  });
});
