import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARCHIVE_COLLECTED_TABLES, ARCHIVE_EXCLUDED_TABLES } from './archive.service';

/**
 * Anti-rot guard for the organizer archive.
 *
 * The archive export→restore round-trip only carries the tables wired into
 * ArchiveService (TABLE_TO_ARCHIVE_KEY). Historically, tables added to the
 * schema were silently dropped on restore because nobody remembered to add
 * them here. This test scans every migration for tables scoped to an event, a
 * tournament or a PHASE and asserts each one is CONSCIOUSLY either collected by
 * the archive or listed in ARCHIVE_EXCLUDED_TABLES. A newly added scoped table
 * fails CI until someone buckets it — no more silent data loss.
 *
 * `phase_id` counts because the guard was blind to it and that blindness was
 * load-bearing: `swiss_rounds` and `swiss_entrants` are phase-scoped and carry
 * every pairing a Swiss phase ever produced, yet neither would have been
 * flagged. The three tables that were already phase-scoped (pools,
 * bracket_slots, matches) were all archived, so widening the scan costs nothing
 * and closes the hole for the next one.
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

/** Table names with an event_id, tournament_id or phase_id column (CREATE or ALTER). */
function scopedTablesFromMigrations(sql: string): { scoped: Set<string>; all: Set<string> } {
  const scoped = new Set<string>();
  const all = new Set<string>();

  // CREATE TABLE [IF NOT EXISTS] [public.]"name" ( ...body... \n);
  const createRe =
    /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\);/gi;
  let match: RegExpExecArray | null;
  while ((match = createRe.exec(sql)) !== null) {
    const name = match[1]!.toLowerCase();
    const body = match[2]!;
    all.add(name);
    if (/\bevent_id\b/.test(body) || /\btournament_id\b/.test(body) || /\bphase_id\b/.test(body)) {
      scoped.add(name);
    }
  }

  // ALTER TABLE name ... ADD COLUMN [IF NOT EXISTS] event_id|tournament_id
  for (const statement of sql.split(';')) {
    const alter = /ALTER TABLE\s+(?:public\.)?"?(\w+)"?/i.exec(statement);
    if (
      alter &&
      /ADD COLUMN(?:\s+IF NOT EXISTS)?\s+(?:event_id|tournament_id|phase_id)\b/i.test(statement)
    ) {
      scoped.add(alter[1]!.toLowerCase());
    }
  }

  return { scoped, all };
}

describe('archive migration coverage', () => {
  const sql = loadMigrationSql();
  const { scoped, all } = scopedTablesFromMigrations(sql);

  it('finds a meaningful set of scoped tables (sanity check on the scanner)', () => {
    // If the regex breaks, this catches it before the real assertion misleads.
    expect(all.has('events')).toBe(true);
    expect(all.has('tournaments')).toBe(true);
    expect(scoped.has('registrations')).toBe(true);
    expect(scoped.size).toBeGreaterThan(15);
  });

  it('every event/tournament-scoped table is either archived or explicitly excluded', () => {
    const unbucketed = [...scoped]
      .filter(
        (table) => !ARCHIVE_COLLECTED_TABLES.has(table) && !ARCHIVE_EXCLUDED_TABLES.has(table),
      )
      .sort();

    expect(
      unbucketed,
      `These scoped tables are neither collected by the archive nor listed in ` +
        `ARCHIVE_EXCLUDED_TABLES. Add each to the archive (TABLE_TO_ARCHIVE_KEY + ` +
        `collect* + INSERT_ORDER) or, if it must not be copied, to ARCHIVE_EXCLUDED_TABLES:\n` +
        unbucketed.map((t) => `  - ${t}`).join('\n'),
    ).toEqual([]);
  });

  it('excluded tables are real tables (guards against typos / dead entries)', () => {
    const unknown = [...ARCHIVE_EXCLUDED_TABLES].filter((table) => !all.has(table)).sort();
    expect(unknown, `ARCHIVE_EXCLUDED_TABLES names tables that no migration creates`).toEqual([]);
  });

  it('no table is both collected and excluded', () => {
    const overlap = [...ARCHIVE_COLLECTED_TABLES].filter((table) =>
      ARCHIVE_EXCLUDED_TABLES.has(table),
    );
    expect(overlap).toEqual([]);
  });
});
